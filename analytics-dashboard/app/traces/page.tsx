'use client';
import { TraceViewer } from '@/components/trace/TraceViewer';
import type { AgentEvent } from '@/components/trace/types';

// ── Mock trace events — one of each widget type ───────────────────────────────
const DEMO_EVENTS: AgentEvent[] = [
  // 1. List context sections
  {
    id: '1', ts: Date.now() - 45000, kind: 'tool_call',
    step: 'analytics_tool[0]_list_context_sections_mcp_atlys_context',
    agent: 'analytics_agent', spec: 'instant_forex',
    input: {},
    output: [
      { section: 'metric:conversion_rate', summary: 'purchase_completed ÷ application_started users', confidence: 0.9 },
      { section: 'issue:K1', summary: 'iOS WebKit OTP autofill regression — Gulf card users most exposed', confidence: 0.85 },
      { section: 'issue:K4', summary: 'Schengen summer slot scarcity Apr–Jun — expected seasonality, not a bug', confidence: 0.8 },
      { section: 'convention:funnel_analysis', summary: 'Use uniqExact(user_id) per step; prefer windowFunnel', confidence: 0.95 },
      { section: 'dataquality:envelope', summary: 'os is null on some Android rows; device_type more reliable', confidence: 0.9 },
    ],
  },

  // 2. Lookup context
  {
    id: '2', ts: Date.now() - 42000, kind: 'tool_call',
    step: 'analytics_tool[1]_lookup_context_mcp_atlys_context',
    agent: 'analytics_agent', spec: 'instant_forex',
    input: { sections: ['metric:conversion_rate', 'issue:K1', 'issue:K4'] },
    output: [
      {
        section: 'metric:conversion_rate',
        title: 'Conversion Rate',
        summary: 'purchase_completed users ÷ application_started users',
        body: 'Use the funnel denominator (application_started), NOT ÷ sessions.\nThese two definitions CONFLICT in base_context — always use the funnel one.',
        confidence: 0.9,
      },
      {
        section: 'issue:K1',
        title: 'iOS WebKit OTP autofill regression',
        summary: 'On recent iOS builds the payment OTP field fails to autofill',
        body: 'Gulf card users are most exposed. Watch pay_now_clicked → purchase_completed for iOS.\nMatching criteria: iOS platform + OTP step + Gulf geo (all three required to claim K1).',
        confidence: 0.85,
      },
    ],
  },

  // 3. List tables
  {
    id: '3', ts: Date.now() - 40000, kind: 'tool_call',
    step: 'analytics_tool[2]_list_tables_mcp_atlys_data',
    agent: 'analytics_agent', spec: 'instant_forex',
    input: { database: 'atlys' },
    output: {
      tables: [
        { table: 'destination_card_clicked', engine: 'MergeTree', row_count: 1000000 },
        { table: 'application_started',      engine: 'MergeTree', row_count: 154413 },
        { table: 'document_uploaded',        engine: 'MergeTree', row_count: 20446 },
        { table: 'purchase_completed',       engine: 'MergeTree', row_count: 7054 },
        { table: 'forex_addon_events',       engine: 'MergeTree', row_count: 6240 },
        { table: 'abandoned_checkout_recovery_events', engine: 'MergeTree', row_count: 5920 },
      ],
      execution_time_ms: 3.1,
    },
  },

  // 4. Describe table
  {
    id: '4', ts: Date.now() - 38000, kind: 'tool_call',
    step: 'analytics_tool[3]_describe_table_mcp_atlys_data',
    agent: 'analytics_agent', spec: 'instant_forex',
    input: { table_name: 'forex_addon_events', database: 'atlys' },
    output: {
      columns: [
        { column: 'id',                        type: 'UUID' },
        { column: 'timestamp',                 type: 'DateTime' },
        { column: 'user_id',                   type: 'String' },
        { column: 'application_id_normalized', type: 'LowCardinality(String)' },
        { column: 'event_type',                type: 'LowCardinality(String)' },
        { column: 'destination',               type: 'LowCardinality(Nullable(String))' },
        { column: 'to_currency',               type: 'LowCardinality(Nullable(String))' },
        { column: 'addon_value_inr',           type: 'Nullable(Float32)' },
      ],
      execution_time_ms: 2.8,
    },
  },

  // 5. Read skill file
  {
    id: '5', ts: Date.now() - 35000, kind: 'tool_call',
    step: 'analytics_tool[4]_read_skill_file',
    agent: 'analytics_agent', spec: 'instant_forex',
    input: { file_path: 'context-engine/SKILL.md' },
    output: {
      content: `# Context Engine Skill\n\nThis skill helps you work with the Atlys context layer stored in \`agent_meta.current_context\`.\n\n## Key conventions\n- Funnel conversion = purchase_completed ÷ application_started (NOT ÷ sessions)\n- Always cut by device_type, geoip_country_code, destination before concluding segment-neutral\n- Use uniqExact(user_id) for funnel steps\n\n## Known issues to check\n- K1: iOS OTP (Gulf-exposed)\n- K4: Schengen summer scarcity (expected, not a bug)`,
      path: 'context-engine/SKILL.md',
    },
  },

  // 6. SQL query — funnel
  {
    id: '6', ts: Date.now() - 30000, kind: 'tool_call',
    step: 'analytics_tool[5]_run_query_mcp_atlys_data',
    agent: 'analytics_agent', spec: 'instant_forex',
    input: {
      query: `SELECT
  event_type,
  uniqExact(application_id_normalized) AS applications,
  uniqExact(user_id)                   AS users
FROM atlys.forex_addon_events
WHERE application_id_normalized != ''
GROUP BY event_type
ORDER BY applications DESC
LIMIT 10`,
      database: 'atlys',
    },
    output: {
      columns: ['event_type', 'applications', 'users'],
      rows: [
        { event_type: 'forex_offer_shown',   applications: 2900, users: 2900 },
        { event_type: 'amount_entered',       applications: 1033, users: 1033 },
        { event_type: 'currency_selected',    applications: 1033, users: 1033 },
        { event_type: 'forex_added_to_cart',  applications: 725,  users: 725  },
        { event_type: 'forex_purchased',      applications: 546,  users: 546  },
      ],
      execution_time_ms: 8.4,
    },
  },

  // 7. SQL query — attach rate by destination
  {
    id: '7', ts: Date.now() - 25000, kind: 'tool_call',
    step: 'analytics_tool[6]_run_query_mcp_atlys_data',
    agent: 'analytics_agent', spec: 'instant_forex',
    input: {
      query: `SELECT
  destination,
  uniqExactIf(application_id_normalized, event_type='forex_offer_shown') AS shown,
  uniqExactIf(application_id_normalized, event_type='forex_purchased')   AS purchased,
  round(100.0 * purchased / nullIf(shown, 0), 2)                         AS attach_pct
FROM atlys.forex_addon_events
WHERE application_id_normalized != ''
GROUP BY destination
HAVING shown >= 30
ORDER BY attach_pct DESC
LIMIT 15`,
      database: 'atlys',
    },
    output: {
      columns: ['destination', 'shown', 'purchased', 'attach_pct'],
      rows: [
        { destination: 'US', shown: 236, purchased: 58, attach_pct: 24.58 },
        { destination: 'SG', shown: 199, purchased: 46, attach_pct: 23.12 },
        { destination: 'TH', shown: 223, purchased: 51, attach_pct: 22.87 },
        { destination: 'MY', shown: 193, purchased: 42, attach_pct: 21.76 },
        { destination: 'AE', shown: 190, purchased: 34, attach_pct: 17.89 },
        { destination: 'AU', shown: 196, purchased: 27, attach_pct: 13.78 },
      ],
      execution_time_ms: 12.4,
    },
  },

  // 8. Python — AOV analysis
  {
    id: '8', ts: Date.now() - 18000, kind: 'tool_call',
    step: 'analytics_tool[7]_execute_python_mcp_atlys_data',
    agent: 'analytics_agent', spec: 'instant_forex',
    input: {
      code: `import pandas as pd
df = pd.read_json('query_forex_values.ndjson', lines=True)

# Percentile distribution of add-on value (INR)
q = df['addon_value_inr'].quantile([0.25, 0.5, 0.75, 0.9])
print(f"p25:  ₹{q[0.25]:,.0f}")
print(f"p50:  ₹{q[0.50]:,.0f}")
print(f"p75:  ₹{q[0.75]:,.0f}")
print(f"p90:  ₹{q[0.90]:,.0f}")
print(f"n:    {len(df)}")`,
    },
    output: {
      stdout: `p25:  ₹16,561
p50:  ₹31,685
p75:  ₹56,489
p90:  ₹87,340
n:    546`,
      stderr: '',
      exit_code: 0,
      truncated: false,
    },
  },

  // 9. Generation — final LLM output
  {
    id: '9', ts: Date.now() - 5000, kind: 'generation',
    step: 'analytics_generation',
    agent: 'analytics_agent', spec: 'instant_forex',
    reasoning: 'Instant Forex attaches at 18.83% overall (546 of 2,900 shown). Biggest funnel drop is before amount entry: only 35.6% of shown applications reached amount_entered — the offer itself drives low engagement. USD and SG destinations lead at 24.6% and 23.1%; AU is weakest at 13.8%. K1 untested (no OTP step in this table); K4 not applicable. Confidence 0.78 given n=2,900 shown apps and clear segment differences.',
    model_reasoning: `Let me work through this systematically.

First I check the table schema — it uses application_id_normalized (LowCardinality) not application_id. The generic seed queries would have joined on application_id and missed most rows. Good thing I checked.

The funnel shows: 2900 shown → 1033 amount_entered (35.6%) → 725 cart_add (70.2% of amount_entered) → 546 purchased (75.3% of cart). So the biggest drop is at the top: offer shown → actually engaging with it.

USD attach is notably highest (24.6%). This might be USD as currency destination, not geo — let me check to_currency as well... The destination column here is the visa destination country, not currency, so US = USA travellers. Need to verify if there's a separate to_currency cut.

K1 requires iOS + OTP + Gulf. This table has no OTP event, so K1 untested. K4 is Schengen/seasonal — not applicable to forex attach.

Confidence: large n (2900), clear segment differences (US 24.6% vs AU 13.8%), all segments n≥30. Setting 0.78 — not higher because I haven't done a causal analysis and the US/AU difference could be selection bias.`,
    output: {
      title: 'Instant Forex reaches 18.83% attach — biggest drop before amount entry, USD leads',
      summary: 'Instant Forex attached to 546 of 2,900 shown applications (18.83% attach rate). The largest funnel loss is offer→amount entry: only 35.6% progressed. USD destination achieved the highest attach at 24.58%; AU was lowest at 13.78%. All principal segment sizes exceed n=30. K1 untested (no OTP step); K4 not applicable.',
      confidence: 0.78,
    },
    usage: { input: 1204, output: 487, reasoning: 1156, total: 2847 },
    trace_url: 'https://us.cloud.langfuse.com/trace/example',
  },
];

export default function TracesPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-8 py-5" style={{ borderColor: '#e5dfd6' }}>
        <h1 className="text-lg font-semibold" style={{ color: '#1c1814' }}>Trace Viewer</h1>
        <p className="mt-0.5 text-sm" style={{ color: '#9c9088' }}>
          Live agent reasoning — every tool call, query, and LLM turn. Click any row to expand.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="max-w-3xl">
          <TraceViewer events={DEMO_EVENTS} traceUrl="https://us.cloud.langfuse.com/trace/example" />
        </div>
      </div>
    </div>
  );
}
