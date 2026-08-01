// Core types matching ClickHouse agent_meta schema

export interface Insight {
  insight_id: string;
  spec_name: string;
  title: string;
  summary: string;
  confidence: number; // 0.0 - 1.0
  evidence: string; // JSON string, currently just {confidence_drivers}
  related_known_issues: string[];
  segment_cuts: string[];
  has_report: boolean; // report_html is non-empty — fetch /api/insights/[id]/report to view
  created_at: string;
  trace_url: string | null;
}

export interface ContextVersion {
  version_id: string;
  section_key: string;
  old_content: string | null;
  new_content: string;
  change_reason: string;
  changed_by_agent: string;
  created_at: string;
  trace_url: string | null;
}

export interface SchemaProposal {
  proposal_id: string;
  spec_id: string;
  agent_run_id: string;
  proposed_ddl: string;
  ordering_key_rationale: string;
  materialized_views: string | null;
  performance_report: string | null; // JSON
  confidence_score: number;
  status: 'drafted' | 'pending_review' | 'approved' | 'needs_rework' | 'executed';
  revision_number: number;
  created_at: string;
  trace_url: string | null;
}

export interface SchemaReview {
  review_id: string;
  proposal_id: string;
  reviewer_agent: string;
  verdict: 'approve' | 'request_changes' | 'block';
  findings: string; // JSON array of finding objects
  reviewed_at: string;
  trace_url: string | null;
}

export interface TestRun {
  run_id: string;
  proposal_id: string;
  test_case_id: string;
  status: 'passed' | 'failed' | 'skipped';
  error_message: string | null;
  execution_time_ms: number;
  executed_at: string;
}

// UI-specific types

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  traceUrl?: string;
}

export interface EvidenceItem {
  type: 'metric' | 'query_result' | 'known_issue' | 'segment_analysis';
  description: string;
  value?: string | number;
  confidence?: number;
}

export interface FindingItem {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  message: string;
  suggested_fix?: string;
}
