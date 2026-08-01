-- Agent metadata layer: schema proposals, reviews, tests, insights, context versions.
-- Separate database from `atlys` (the event data) — this is our own workflow state.

CREATE DATABASE IF NOT EXISTS agent_meta;

CREATE TABLE IF NOT EXISTS agent_meta.schema_proposals
(
    proposal_id UUID,
    parent_proposal_id Nullable(UUID),
    revision UInt8 DEFAULT 0,
    ts DateTime DEFAULT now(),
    spec_name String,
    table_name String,
    ddl String,
    ordering_key String,
    partition_key String,
    materialized_views Array(String),
    perf_report String,
    confidence Float32,
    rationale String,
    status Enum8(
        'drafted'=1,
        'pending_review'=2,
        'needs_rework'=3,
        'approved'=4,
        'executed'=5,
        'rejected'=6
    ),
    trace_url String
)
ENGINE = MergeTree
ORDER BY (spec_name, ts);

CREATE TABLE IF NOT EXISTS agent_meta.schema_reviews
(
    review_id UUID,
    ts DateTime DEFAULT now(),
    proposal_id UUID,
    revision UInt8,
    verdict Enum8('approve'=1,'request_changes'=2,'block'=3),
    findings String,
    context_sections_used Array(String),
    reviewer_confidence Float32,
    trace_url String
)
ENGINE = MergeTree
ORDER BY (proposal_id, ts);

CREATE TABLE IF NOT EXISTS agent_meta.test_cases
(
    test_id UUID,
    ts DateTime DEFAULT now(),
    introduced_by_proposal_id UUID,
    table_name String,
    test_type Enum8('schema'=1,'insert_integrity'=2,'query_smoke'=3,'mv_integrity'=4),
    query String,
    expected String,
    description String
)
ENGINE = MergeTree
ORDER BY (table_name, ts);

CREATE TABLE IF NOT EXISTS agent_meta.test_runs
(
    run_id UUID,
    ts DateTime DEFAULT now(),
    proposal_id UUID,
    test_id UUID,
    passed UInt8,
    actual String,
    duration_ms UInt32,
    trace_url String
)
ENGINE = MergeTree
ORDER BY (proposal_id, ts);

CREATE TABLE IF NOT EXISTS agent_meta.insights
(
    insight_id UUID,
    ts DateTime DEFAULT now(),
    spec_name String,
    title String,
    summary String,
    segment_cuts Array(String),
    evidence String,
    related_known_issues Array(String),
    confidence Float32,
    trace_url String,
    report_html String DEFAULT ''   -- self-contained HTML insight report (see analytics/analytics_agent.py)
)
ENGINE = MergeTree
ORDER BY (spec_name, ts);

CREATE TABLE IF NOT EXISTS agent_meta.context_versions
(
    version_id UUID,
    ts DateTime DEFAULT now(),
    section String,
    before String,
    after String,
    diff_summary String,
    rationale String,
    trigger String,
    confidence Float32,
    trace_url String
)
ENGINE = MergeTree
ORDER BY (section, ts);
