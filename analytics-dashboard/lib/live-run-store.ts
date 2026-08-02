// Tracks the currently in-progress (or most-recently-finished) ingestion run
// server-side, independent of any single browser request.
//
// Why this exists: /api/ingest streams progress back over the SAME HTTP
// response that started the run (a POST whose body is an SSE stream). That
// works fine while the tab that started it stays open, but the stream is
// tied to that one request/response pair -- a page reload (or opening the
// app in a second tab) has no way to reattach to it, so the live trace of an
// still-running ingestion was simply gone after a reload. This module is fed
// by /api/ingest as it already parses each line, and any client can query
// /api/live-run to get the current snapshot (active or not) and reconnect.
//
// Single in-memory object, not a queue-per-run: this pipeline is used
// interactively, one ingestion at a time, from one dev server process --
// no need for multi-run tracking or cross-process persistence.
//
// `kind` distinguishes an ingestion run (/api/ingest, agent='pipeline':
// propose/review/execute) from an analytics run (/api/analytics,
// agent='analytics') sharing this same slot. Without it, agent-panel.tsx's
// history-mode reconnect check only compared specName -- and since analytics
// can only be triggered on a spec that's already 'executed' (i.e. a
// COMPLETED spec), starting an analytics run for spec X and then clicking
// spec X in the specs list made history mode believe X's ingestion pipeline
// was live, showing the analytics agent's live trace instead.

export type LiveRunKind = 'ingest' | 'analytics';

export interface LiveRunSnapshot {
  specName: string | null;
  kind: LiveRunKind | null;
  active: boolean;
  startedAt: number | null;
  events: Record<string, any>[]; // raw trace_event payloads, same shape /api/ingest forwards
  result: Record<string, any> | null;
}

let state: LiveRunSnapshot = {
  specName: null, kind: null, active: false, startedAt: null, events: [], result: null,
};

export function startRun(specName: string, kind: LiveRunKind = 'ingest'): void {
  state = { specName, kind, active: true, startedAt: Date.now(), events: [], result: null };
}

export function pushRawEvent(event: Record<string, any>): void {
  if (!state.active) return;
  state.events.push(event);
}

export function finishRun(result: Record<string, any>): void {
  state = { ...state, active: false, result };
}

export function getSnapshot(): LiveRunSnapshot {
  return state;
}
