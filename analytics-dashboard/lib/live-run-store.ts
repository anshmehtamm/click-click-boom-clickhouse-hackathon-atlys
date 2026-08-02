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
// Backed by a file, not a plain in-memory `let state` object: Next.js dev
// mode hot-reloads any route module whenever a file in its dependency graph
// changes, which re-evaluates this module and resets a plain in-memory
// variable back to its initial value -- while the spawned Python subprocess
// (a real, separate OS process) keeps writing genuine progress completely
// unaffected. Two real incidents from this: an active run's proposal
// appearing to vanish from the UI, and a run that had already finished (161
// events, ended in revision_cap_hit/approved/test_harness, confirmed via
// agent_meta.trace_events) staying stuck showing a stale 14-event snapshot
// from before an unrelated edit reloaded the module mid-run -- `active` never
// flipped to false because `finishRun` landed on a DIFFERENT, later module
// instance than the one `/api/live-run`'s GET handler was reading from. A
// file on disk survives module re-evaluation because it isn't part of the
// module's JS heap.
//
// Single active run, not a queue: this pipeline is used interactively, one
// ingestion (or one analytics run) at a time, from one dev server process --
// no need for multi-run tracking. `kind` distinguishes an ingestion run
// (/api/ingest, agent='pipeline': propose/review/execute) from an analytics
// run (/api/analytics, agent='analytics') sharing this same slot -- see
// agent-panel.tsx's reconnect checks, which require the kind to match what
// they actually mean before treating a snapshot as "this is live".

import fs from 'fs';
import path from 'path';
import os from 'os';

const STATE_FILE = path.join(os.tmpdir(), 'atlys-live-run-state.json');

export type LiveRunKind = 'ingest' | 'analytics';

export interface LiveRunSnapshot {
  specName: string | null;
  kind: LiveRunKind | null;
  active: boolean;
  startedAt: number | null;
  events: Record<string, any>[]; // raw trace_event payloads, same shape /api/ingest forwards
  result: Record<string, any> | null;
}

const EMPTY_STATE: LiveRunSnapshot = {
  specName: null, kind: null, active: false, startedAt: null, events: [], result: null,
};

function readState(): LiveRunSnapshot {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return EMPTY_STATE;
  }
}

function writeState(state: LiveRunSnapshot): void {
  try {
    // Synchronous and same-tick with every caller (all of which originate
    // from one spawned child process's stdout 'data' handler within one
    // Node event loop) -- no concurrent-write race in practice.
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch {
    // Best-effort -- losing the durability layer shouldn't crash the run.
  }
}

export function startRun(specName: string, kind: LiveRunKind = 'ingest'): void {
  writeState({ specName, kind, active: true, startedAt: Date.now(), events: [], result: null });
}

export function pushRawEvent(event: Record<string, any>): void {
  const state = readState();
  if (!state.active) return;
  state.events.push(event);
  writeState(state);
}

export function finishRun(result: Record<string, any>): void {
  const state = readState();
  writeState({ ...state, active: false, result });
}

export function getSnapshot(): LiveRunSnapshot {
  return readState();
}
