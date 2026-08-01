import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export const maxDuration = 300; // 5 minutes for long-running ingestion

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const specName = formData.get('specName') as string;
    const specMarkdown = formData.get('specMarkdown') as string;
    const eventsFile = formData.get('eventsFile') as File;

    if (!specName || !specMarkdown || !eventsFile) {
      const encoder = new TextEncoder();
      return new Response(encoder.encode(JSON.stringify({
        type: 'error',
        message: 'Missing required fields'
      })), {
        headers: { 'Content-Type': 'text/event-stream' }
      });
    }

    // Parse events from NDJSON file
    const eventsText = await eventsFile.text();
    const allEvents = eventsText
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));

    // Stratified sample, capped per event type (same PER_EVENT_SAMPLE=30 convention
    // as scripts/run_*.py) — the raw file can be thousands of rows, and sending that
    // whole thing as the propose payload blows the agent's context window entirely
    // (measured: a 6237-row unsampled file produced a >10M-token single message,
    // which LibreChat prunes to empty and then 500s on). The proposer only needs a
    // representative sample of each event's shape, not the full volume.
    const PER_EVENT_SAMPLE = 30;
    const byEventType = new Map<string, any[]>();
    for (const e of allEvents) {
      const key = e.event ?? 'unknown';
      const arr = byEventType.get(key) ?? [];
      if (arr.length < PER_EVENT_SAMPLE) { arr.push(e); byEventType.set(key, arr); }
    }
    const events = [...byEventType.values()].flat();

    if (events.length === 0) {
      const encoder = new TextEncoder();
      return new Response(encoder.encode(JSON.stringify({
        type: 'error',
        message: 'No events found in the uploaded file'
      })), {
        headers: { 'Content-Type': 'text/event-stream' }
      });
    }

    // Create readable stream for Server-Sent Events
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        const sendEvent = (data: any) => {
          const message = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
        };

        // Write events + spec to temp JSON files — avoids JSON→Python literal mismatch
        // (JSON false/true/null ≠ Python False/True/None)
        const ts = Date.now();
        const tmpEventsPath  = path.join('/tmp', `events_${ts}.json`);
        const tmpSpecPath    = path.join('/tmp', `spec_${ts}.md`);
        const tmpScriptPath  = path.join('/tmp', `ingest_${ts}.py`);

        fs.writeFileSync(tmpEventsPath,  JSON.stringify(events));
        fs.writeFileSync(tmpSpecPath,    specMarkdown);

        const agentsPath = path.join(process.cwd(), '../atlys-agents');
        const pythonScript = `
import sys, json
sys.path.insert(0, ${JSON.stringify(agentsPath)})

def log_progress(stage, message):
    print(json.dumps({"type": "log", "stage": stage, "message": message}), flush=True)

log_progress("init", "Starting ingestion pipeline...")

with open(${JSON.stringify(tmpEventsPath)}) as f:
    sample_events = json.load(f)

with open(${JSON.stringify(tmpSpecPath)}) as f:
    spec_markdown = f.read()

log_progress("init", f"Loaded {len(sample_events)} sample events")

from orchestrator import ingest_spec

log_progress("orchestrator", "Calling ingest_spec...")

try:
    result = ingest_spec(
        spec_name=${JSON.stringify(specName)},
        spec_markdown=spec_markdown,
        sample_events=sample_events,
    )
    log_progress("complete", "Pipeline finished")
    print(json.dumps({"type": "result", "data": result}, default=str), flush=True)
except Exception as e:
    import traceback
    log_progress("error", f"Pipeline failed: {str(e)}")
    log_progress("error", traceback.format_exc())
    print(json.dumps({"type": "result", "data": {"error": str(e), "status": "failed"}}, default=str), flush=True)
    sys.exit(1)
`;
        fs.writeFileSync(tmpScriptPath, pythonScript);

        sendEvent({ type: 'log', stage: 'init', message: '🚀 Initializing pipeline...' });

        const agentsDir = path.join(process.cwd(), '../atlys-agents');
        const venvPython = path.join(agentsDir, '.venv/bin/python');

        // Load atlys-agents .env vars so the subprocess has ClickHouse/Langfuse creds
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
              }
            } catch (e) {
              // If not JSON, send as raw log
              sendEvent({ type: 'log', stage: 'output', message: line });
            }
          }
        });

        python.stderr.on('data', (data) => {
          const lines = data.toString().split('\n').filter((l: string) => l.trim());
          for (const line of lines) {
            // Skip noisy OTEL/tracing chatter
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
          for (const f of [tmpScriptPath, tmpEventsPath, tmpSpecPath]) {
            try { fs.unlinkSync(f); } catch { /* ignore */ }
          }

          if (finalResult) {
            sendEvent({ type: 'complete', result: finalResult });
          } else {
            sendEvent({
              type: 'complete',
              result: { status: 'failed', error: `Process exited with code ${code} — check run log above` }
            });
          }
          controller.close();
        });

        // Timeout after 4 minutes
        setTimeout(() => {
          python.kill();
          sendEvent({ type: 'error', message: 'Pipeline timeout after 4 minutes' });
          controller.close();
        }, 240000);
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Ingestion error:', error);
    const encoder = new TextEncoder();
    return new Response(encoder.encode(JSON.stringify({
      type: 'error',
      message: error instanceof Error ? error.message : 'Failed to run ingestion'
    })), {
      headers: { 'Content-Type': 'text/event-stream' }
    });
  }
}
