// In-memory approval state — Python orchestrator polls GET /api/approvals?proposal_id=xxx
type Decision = 'pending' | 'approved' | 'rejected';
interface Record { decision: Decision; comment: string; ts: number; }

const store = new Map<string, Record>();

export function getDecision(id: string): Decision {
  return store.get(id)?.decision ?? 'pending';
}

export function setDecision(id: string, decision: 'approved' | 'rejected', comment = ''): void {
  store.set(id, { decision, comment, ts: Date.now() });
}
