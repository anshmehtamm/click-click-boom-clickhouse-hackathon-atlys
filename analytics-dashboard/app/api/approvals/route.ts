import { NextRequest, NextResponse } from 'next/server';
import { getDecision, setDecision } from '@/lib/approval-store';
import { getSchemaProposals } from '@/lib/clickhouse';
import { pushEvent } from '@/lib/agent-store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const proposalId = searchParams.get('proposal_id');

  // Python orchestrator polls: GET /api/approvals?proposal_id=xxx
  if (proposalId) {
    return NextResponse.json({ decision: getDecision(proposalId) });
  }

  // Dashboard polls: GET /api/approvals — returns pending proposals from ClickHouse
  try {
    const proposals = await getSchemaProposals(20);
    const pending = proposals.filter((p) => p.status === 'pending_review');
    return NextResponse.json(pending);
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  const { proposal_id, decision, comment } = await req.json();
  if (!proposal_id || !['approved', 'rejected'].includes(decision)) {
    return NextResponse.json({ error: 'Invalid' }, { status: 400 });
  }
  setDecision(proposal_id, decision, comment ?? '');
  pushEvent({
    agent: 'human',
    spec: '',
    step: 'human_approval',
    status: decision === 'approved' ? 'done' : 'error',
    message: `Human ${decision} proposal ${proposal_id.slice(0, 8)}…${comment ? ` "${comment}"` : ''}`,
    proposal_id,
  });
  return NextResponse.json({ ok: true });
}
