import { createClient } from '@clickhouse/client';
import type { Insight, ContextVersion, SchemaProposal, SchemaReview, TestRun } from './types';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://your-instance.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'agent_meta',
});

export async function getInsights(limit = 50): Promise<Insight[]> {
  const result = await client.query({
    query: `
      SELECT
        insight_id,
        spec_name as spec_id,
        '' as agent_run_id,
        title as question,
        summary as answer_text,
        confidence as confidence_score,
        evidence as supporting_evidence,
        '[]' as contradicting_signals,
        formatDateTime(ts, '%Y-%m-%d %H:%i:%s') as created_at,
        trace_url
      FROM agent_meta.insights
      ORDER BY ts DESC
      LIMIT ${limit}
    `,
    format: 'JSONEachRow',
  });

  const data = await result.json<Insight[]>();
  return data;
}

export async function getContextVersions(limit = 100): Promise<ContextVersion[]> {
  const result = await client.query({
    query: `
      SELECT
        version_id,
        section as section_key,
        before as old_content,
        after as new_content,
        diff_summary as change_reason,
        trigger as changed_by_agent,
        formatDateTime(ts, '%Y-%m-%d %H:%i:%s') as created_at,
        trace_url
      FROM agent_meta.context_versions
      ORDER BY ts DESC
      LIMIT ${limit}
    `,
    format: 'JSONEachRow',
  });

  const data = await result.json<ContextVersion[]>();
  return data;
}

export async function getSchemaProposals(limit = 50): Promise<SchemaProposal[]> {
  const result = await client.query({
    query: `
      SELECT
        proposal_id,
        spec_name as spec_id,
        '' as agent_run_id,
        ddl as proposed_ddl,
        rationale as ordering_key_rationale,
        arrayStringConcat(materialized_views, '\n\n') as materialized_views,
        perf_report as performance_report,
        confidence as confidence_score,
        status,
        revision as revision_number,
        formatDateTime(ts, '%Y-%m-%d %H:%i:%s') as created_at,
        trace_url
      FROM agent_meta.schema_proposals
      ORDER BY ts DESC
      LIMIT ${limit}
    `,
    format: 'JSONEachRow',
  });

  const data = await result.json<SchemaProposal[]>();
  return data;
}

export async function getSchemaReviews(proposalId?: string): Promise<SchemaReview[]> {
  const whereClause = proposalId ? `WHERE proposal_id = '${proposalId}'` : '';

  const result = await client.query({
    query: `
      SELECT
        review_id,
        proposal_id,
        '' as reviewer_agent,
        verdict,
        findings,
        formatDateTime(ts, '%Y-%m-%d %H:%i:%s') as reviewed_at,
        trace_url
      FROM agent_meta.schema_reviews
      ${whereClause}
      ORDER BY ts DESC
      LIMIT 100
    `,
    format: 'JSONEachRow',
  });

  const data = await result.json<SchemaReview[]>();
  return data;
}

export async function getTestRuns(proposalId?: string): Promise<TestRun[]> {
  const whereClause = proposalId ? `WHERE proposal_id = '${proposalId}'` : '';

  const result = await client.query({
    query: `
      SELECT
        run_id,
        proposal_id,
        test_id as test_case_id,
        IF(passed = 1, 'passed', 'failed') as status,
        actual as error_message,
        duration_ms as execution_time_ms,
        formatDateTime(ts, '%Y-%m-%d %H:%i:%s') as executed_at
      FROM agent_meta.test_runs
      ${whereClause}
      ORDER BY ts DESC
      LIMIT 100
    `,
    format: 'JSONEachRow',
  });

  const data = await result.json<TestRun[]>();
  return data;
}

export async function getInsightStats() {
  const result = await client.query({
    query: `
      SELECT
        count() as total_insights,
        avg(confidence) as avg_confidence,
        countIf(confidence >= 0.8) as high_confidence_count,
        countIf(confidence < 0.6) as low_confidence_count
      FROM agent_meta.insights
    `,
    format: 'JSONEachRow',
  });

  const data = await result.json<any[]>();
  return data[0] || {};
}
