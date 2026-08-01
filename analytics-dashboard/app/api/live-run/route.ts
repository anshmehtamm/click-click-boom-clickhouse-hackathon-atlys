import { NextResponse } from 'next/server';
import { getSnapshot } from '@/lib/live-run-store';

export const dynamic = 'force-dynamic';

// Polled by the client on load/reload (and while a run is active) to detect
// and reattach to an in-progress ingestion — see lib/live-run-store.ts for
// why this exists separately from /api/ingest's own SSE stream.
export async function GET() {
  return NextResponse.json(getSnapshot());
}
