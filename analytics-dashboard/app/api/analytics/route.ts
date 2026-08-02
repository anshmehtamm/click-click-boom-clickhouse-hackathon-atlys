import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { startRun, pushRawEvent, finishRun, getSnapshot } from '@/lib/live-run-store';

export const maxDuration = 300; // analytics is agentic/multi-turn, same budget as ingest

// Counterpart to /api/ingest for the analytics half of the pipeline: runs
// analytics.analytics_agent.run_analytics_for_spec(spec_name) as a subprocess,
// streaming the same trace_event/log/complete SSE shape /api/ingest already
// produces -- the right panel (components/agent-panel.tsx) renders both
// through the exact same TraceViewer, no branching needed there for the wire
// format itself. Shares live-run-store with ingest (same single-run-at-a-time
// slot) since this pipeline is used interactively, one run at a time, from
// one dev server process, same as ingestion.
export async function POST(request: NextRequest) {
  try {
    const { specName } = await request.json();

    const inFlight = getSnapshot();
    if (inFlight.active) {
      const encoder = new TextEncoder();
      return new Response(encoder.encode(JSON.stringify({
        type: 'error',
        message: `A run for "${inFlight.specName}" is already in progress — wait for it to finish before starting another.`,
      })), { headers: { 'Content-Type': 'text/event-stream' } });
    }

    if (!specName) {
      const encoder = new TextEncoder();
      return new Response(encoder.encode(JSON.stringify({
        type: 'error', message: 'Missing specName',
      })), { headers: { 'Content-Type': 'text/event-stream' } });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const sendEvent = (data: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        const ts = Date.now();
        const tmpScriptPath = path.join('/tmp', `analytics_${ts}.py`);
        const agentsPath = path.join(process.cwd(), '../atlys-agents');

        const pythonScript = `
import sys, json
sys.path.insert(0, ${JSON.stringify(agentsPath)})

def log_progress(stage, message):
    print(json.dumps({"type": "log", "stage": stage, "message": message}), flush=True)

log_progress("init", "Starting analytics agent...")

from analytics.analytics_agent import run_analytics_for_spec

try:
    result = run_analytics_for_spec(${JSON.stringify(specName)})
    log_progress("complete", "Analytics finished")
    print(json.dumps({"type": "result", "data": result}, default=str), flush=True)
except Exception as e:
    import traceback
    log_progress("error", f"Analytics failed: {str(e)}")
    log_progress("error", traceback.format_exc())
    print(json.dumps({"type": "result", "data": {"error": str(e), "status": "failed"}}, default=str), flush=True)
    sys.exit(1)
`;
        fs.writeFileSync(tmpScriptPath, pythonScript);

        sendEvent({ type: 'log', stage: 'init', message: '🚀 Starting analytics agent...' });
        startRun(specName, 'analytics');

        const agentsDir = path.join(process.cwd(), '../atlys-agents');
        const venvPython = path.join(agentsDir, '.venv/bin/python');

        const agentsEnv: Record<string, string> = {};
        try {
          const envFile = fs.readFileSync(path.join(agentsDir, '.env'), 'utf8');
          for (const line of envFile.split('\n')) {
            const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
            if (m) agentsEnv[m[1]] = m[2].replace(/^["']|["']$/g, '');
          }
        } catch { /* .env not found, continue */ }

        const python = spawn(venvPython, [tmpScriptPath], {
          env: {
            ...process.env,
            ...agentsEnv,
            PYTHONPATH: agentsDir,
            PYTHONUNBUFFERED: '1',
            EMIT_TRACE_EVENTS_STDOUT: '1',
          },
        });

        let finalResult: any = null;

        python.stdout.on('data', (data) => {
          const lines = data.toString().split('\n').filter((l: string) => l.trim());
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === 'result') {
                finalResult = parsed.data;
              } else {
                sendEvent(parsed);
                if (parsed.type === 'trace_event') pushRawEvent(parsed);
              }
            } catch (e) {
              sendEvent({ type: 'log', stage: 'output', message: line });
            }
          }
        });

        python.stderr.on('data', (data) => {
          const lines = data.toString().split('\n').filter((l: string) => l.trim());
          for (const line of lines) {
            if (line.includes('opentelemetry') || line.includes('OTLP') ||
                line.includes('Transient error') || line.includes('retrying in') ||
                line.includes('Failed to export') || line.includes('localhost:4317')) continue;

            const stage = line.includes('ERROR') || line.includes('Traceback') || line.includes('Exception')
              ? 'error'
              : line.includes('tool_call') || line.includes('list_context') || line.includes('run_query')
              ? 'tool'
              : line.includes('WARNING') ? 'warning'
              : 'trace';

            sendEvent({ type: 'log', stage, message: line });
          }
        });

        python.on('close', (code) => {
          try { fs.unlinkSync(tmpScriptPath); } catch { /* ignore */ }

          const result = finalResult ?? { status: 'failed', error: `Process exited with code ${code} — check run log above` };
          sendEvent({ type: 'complete', result });
          finishRun(result);
          controller.close();
        });

        // Timeout after 4 minutes, same budget as ingest
        setTimeout(() => {
          python.kill();
          const result = { status: 'failed', error: 'Analytics timeout after 4 minutes' };
          sendEvent({ type: 'error', message: result.error });
          finishRun(result);
          controller.close();
        }, 240000);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Analytics trigger error:', error);
    const encoder = new TextEncoder();
    return new Response(encoder.encode(JSON.stringify({
      type: 'error',
      message: error instanceof Error ? error.message : 'Failed to run analytics',
    })), { headers: { 'Content-Type': 'text/event-stream' } });
  }
}
