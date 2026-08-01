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
    const events = eventsText
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));

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

        // Create a temporary Python script with verbose logging
        const pythonScript = `
import sys
import json
import time
sys.path.insert(0, '${path.join(process.cwd(), '../atlys-agents')}')

def log_progress(stage, message):
    print(json.dumps({"type": "log", "stage": stage, "message": message}), flush=True)

log_progress("init", "Starting ingestion pipeline...")
log_progress("init", "Loading ${events.length} sample events")

from orchestrator import ingest_spec

spec_name = ${JSON.stringify(specName)}
spec_markdown = ${JSON.stringify(specMarkdown)}
sample_events = ${JSON.stringify(events)}

log_progress("orchestrator", "Calling ingest_spec function...")

try:
    result = ingest_spec(
        spec_name=spec_name,
        spec_markdown=spec_markdown,
        sample_events=sample_events,
    )
    log_progress("complete", "Pipeline finished successfully")
    print(json.dumps({"type": "result", "data": result}, default=str), flush=True)
except Exception as e:
    log_progress("error", f"Pipeline failed: {str(e)}")
    print(json.dumps({"type": "result", "data": {"error": str(e), "status": "failed"}}, default=str), flush=True)
    sys.exit(1)
`;

        const tmpScriptPath = path.join('/tmp', `ingest_${Date.now()}.py`);
        fs.writeFileSync(tmpScriptPath, pythonScript);

        sendEvent({ type: 'log', stage: 'init', message: '🚀 Initializing pipeline...' });

        const python = spawn('python3', [tmpScriptPath], {
          env: {
            ...process.env,
            PYTHONPATH: path.join(process.cwd(), '../atlys-agents'),
            PYTHONUNBUFFERED: '1', // Disable Python output buffering
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
          const stderr = data.toString();
          // Parse Langfuse/ClickHouse/MCP logs for better UX
          const lines = stderr.split('\n').filter((l: string) => l.trim());
          for (const line of lines) {
            // Tool call detection
            if (line.includes('tool_call') || line.includes('list_context_sections') ||
                line.includes('lookup_context') || line.includes('run_query') ||
                line.includes('MCP') || line.includes('mcp_')) {
              sendEvent({ type: 'log', stage: 'tool', message: line });
            }
            // Agent stages
            else if (line.includes('propose') || line.includes('review') ||
                     line.includes('perf_') || line.includes('test_harness') ||
                     line.includes('execute') || line.includes('chronicle')) {
              sendEvent({ type: 'log', stage: 'trace', message: line });
            }
            // Errors and warnings
            else if (line.includes('ERROR')) {
              sendEvent({ type: 'log', stage: 'error', message: line });
            } else if (line.includes('WARN')) {
              sendEvent({ type: 'log', stage: 'warning', message: line });
            }
          }
        });

        python.on('close', (code) => {
          // Clean up temp file
          try {
            fs.unlinkSync(tmpScriptPath);
          } catch (e) {
            // Ignore cleanup errors
          }

          if (code === 0 && finalResult) {
            sendEvent({ type: 'complete', result: finalResult });
          } else {
            sendEvent({
              type: 'complete',
              result: { status: 'failed', error: 'Process exited unexpectedly' }
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
