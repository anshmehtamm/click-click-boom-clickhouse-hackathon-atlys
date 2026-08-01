# Atlys Click-a-thon — Build Plan (3 people, 10 hours)

## Architecture (final)

```
                    ┌─────────────────────────┐
   chat questions   │  LibreChat (as-is UI)   │  spec ingestion (upload/paste)
   ───────────────► │  chat + agent tool-calls│ ◄────────────────────────────
                    └───────────┬─────────────┘
                                │ calls
                    ┌───────────▼─────────────┐
                    │   Agent server           │
                    │  - Instrumentation Agent │──► perf_tool (deterministic)
                    │  - Analytics Agent       │
                    │  - Context Agent         │
                    └───────────┬─────────────┘
                     writes │        │ traces
                    ┌────────▼───┐  ┌▼────────────┐
                    │ ClickHouse │  │ Langfuse     │
                    │ atlys (evt)│  │ Cloud        │
                    │ agent_meta │  └──────────────┘
                    │ (schemas,  │
                    │  insights, │
                    │  context)  │
                    └────────┬───┘
                             │ reads
                    ┌────────▼───────────────┐
                    │ Lightweight custom      │
                    │ dashboard (separate app)│
                    │ - schema changes        │
                    │ - insights + confidence │
                    │ - context diff/changelog│
                    │ - "view full trace →"   │
                    └─────────────────────────┘
```

**Key decisions already made:**

- ClickHouse only — no Postgres. Agent metadata (context versions, schema proposals,
insights) lives in a separate `agent_meta` database on the same Cloud service, as
plain append-only MergeTree tables.
- LibreChat used only for what's genuinely chat-shaped: asking analytics questions,
submitting a new spec. Not customized/themed — default UI, wired to our agent
endpoints as tools.
- The dashboard is a **separate, minimal app**, decoupled from LibreChat, reading
directly from `agent_meta`. This is explicitly allowed ("lightweight UI or
structured CLI output") and keeps dashboard work from blocking agent work.
- Langfuse Cloud. Every agent action opens a tagged trace; the resulting `trace_url`
is stored alongside whatever row it produced, so the dashboard can deep-link out
instead of re-rendering trace detail itself.

---

## Shared contracts — lock these in the first hour, before anyone codes agent logic

Everything downstream depends on these. Get rough agreement fast, don't gold-plate.

### 1. `agent_meta` schema (ClickHouse, separate DB from `atlys`)

```sql
CREATE DATABASE IF NOT EXISTS agent_meta;

CREATE TABLE agent_meta.schema_proposals
(
    proposal_id UUID,
    ts DateTime DEFAULT now(),
    spec_name String,               -- e.g. 'express_checkout', 'unseen'
    table_name String,
    ddl String,
    ordering_key String,
    partition_key String,
    materialized_views Array(String),
    perf_report String,             -- JSON blob from perf_tool
    confidence Float32,
    rationale String,
    status Enum8('proposed'=1,'executed'=2,'rejected'=3),
    trace_url String
)
ENGINE = MergeTree ORDER BY (spec_name, ts);

CREATE TABLE agent_meta.insights
(
    insight_id UUID,
    ts DateTime DEFAULT now(),
    spec_name String,
    title String,
    summary String,                 -- the PM-facing write-up
    segment_cuts Array(String),
    evidence String,                -- JSON: queries run + key numbers
    related_known_issues Array(String),
    confidence Float32,
    trace_url String
)
ENGINE = MergeTree ORDER BY (spec_name, ts);

CREATE TABLE agent_meta.context_versions
(
    version_id UUID,
    ts DateTime DEFAULT now(),
    section String,                 -- e.g. 'metric:conversion_rate', 'table:express_checkout_events'
    before String,
    after String,
    diff_summary String,
    rationale String,
    trigger String,                 -- what caused this: 'new_table', 'contradiction_found', 'manual'
    confidence Float32,
    trace_url String
)
ENGINE = MergeTree ORDER BY (section, ts);
```

`context_versions` is append-only. "Current context" = latest row per `section`
(`argMax(after, ts) GROUP BY section` or a small `current_context` view on top).

### 2. `perf_tool` interface (owned by Person A, called as a black box by nobody else — just needs to exist)

```
run_perf_test(
  candidates: [{ ddl: str, ordering_key: str, partition_key: str }],
  sample_source: str,        # existing raw table or NDJSON path to load from
  query_patterns: [str]      # parameterized test queries, e.g. time-range + segment groupby
) -> {
  candidates: [{ ordering_key, avg_query_ms, rows_read, compressed_bytes }],
  baseline: {...},           # naive ORDER BY (id, timestamp, user_id), for comparison
  winner: str,
  speedup_vs_baseline: float
}
```

Runs against a scratch DB (`agent_meta_scratch` or `atlys_staging`) so it never
touches production tables. This is what makes the Instrumentation Agent's ordering-key
choice *evidence-based* instead of vibes — this is the single highest-leverage piece
for the "schema quality" judging criterion, so don't cut it under time pressure.

### 3. Langfuse tracing wrapper (owned by Person C, needed by A and B immediately)

A thin helper both agents import:

```python
with traced_run(agent="instrumentation", spec="express_checkout") as trace:
    ...
    trace.log(step="propose_ordering_key", input=..., output=..., reasoning=...)
    ...
trace_url = trace.url   # stored in the row written to agent_meta
```

Tags: `agent:{instrumentation|analytics|context}`, `spec:{slug}`, `run:{date}`.
Ship this by hour 1 — everything else logs through it.

### 4. Instrumentation Agent I/O contract

- **In:** `{ spec_markdown: str, sample_events: list[dict] }`
- **Out:** `{ table_name, ddl, column_mapping, materialized_views, perf_report, confidence, rationale, trace_url }`
- This exact object is both (a) what gets inserted into `schema_proposals` and
(b) what actually gets executed against `atlys`. One artifact, two uses — don't
let these drift into two different representations.

### 5. Confidence methodology (write this down once, apply everywhere — judges will ask "why 0.8?")

- **Schema proposal confidence:** driven by `perf_tool`'s `speedup_vs_baseline`,
plus % of raw event fields successfully typed/mapped (unmapped fields lower it).
- **Insight confidence:** sample size behind the finding (uniq users/rows) +
effect size (is the segment gap bigger than normal noise, e.g. >2x the
baseline variance) + whether it corroborates or contradicts a known-issues-log
entry (corroborates → higher; contradicts → flagged, not just silently trusted —
see the K1/K6 contradictions found in `Atlys/analysis/`).
- **Context commit confidence:** number of independent signals agreeing (e.g. a
null-rate anomaly seen across multiple tables scores higher than one column
in one table).

---

## Task breakdown

### Person A — Instrumentation Agent + `perf_tool`


| Hour | Task                                                                                                                                                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–1  | ClickHouse creds confirmed; create `agent_meta` DB + tables; scaffold `perf_tool` function signature and CH connection.                                                                                                                                                                        |
| 1–3  | Build `perf_tool`: auto-create scratch tables for candidate DDLs, load sample data, run a fixed query battery (time-filter, segment `GROUP BY`, funnel-style join), time it, compare vs. a naive baseline (`ORDER BY (id, timestamp, user_id)` — the legacy pattern already in `ddl.sql`).     |
| 3–6  | Build Instrumentation Agent: spec.md + NDJSON → infer types/nullability → propose 2–3 ordering-key/partition candidates → call `perf_tool` → pick winner with rationale → generate `CREATE TABLE` + any needed MVs → execute against `atlys` → log to Langfuse → write `schema_proposals` row. |
| 6–7  | Run it for real against 2–3 of the 5 known specs (prioritize **Express Checkout** and **Abandoned Checkout Recovery** — Person B needs real tables to query against).                                                                                                                          |
| 7–8  | Robustness pass: nested fields (Express Checkout's `payment.amount`/`payment.latency_ms`), missing/optional fields, messy specs.                                                                                                                                                               |
| 8–9  | Unseen-spec dry run (treat one held-back known spec as "unseen"), fix breakage.                                                                                                                                                                                                                |
| 9–10 | Final polish, confirm clean run for the real unseen-spec drop.                                                                                                                                                                                                                                 |


### Person B — Analytics Agent + Context Agent


| Hour | Task                                                                                                                                                                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–1  | Seed context from `base_context.md` + the contradictions already found in `Atlys/analysis/00_overview.md` (missing `visa_issuance_eta_days`, K1/K6 not holding up, application_id not always empty). Agree on `context_versions` schema with A/C.                                                                |
| 1–3  | Build Context Agent: scan `system.columns`/`schema_proposals` for new/changed tables, diff against current context, draft an update with rationale + confidence, write `context_versions` row, log to Langfuse.                                                                                                  |
| 3–6  | Build Analytics Agent: pull current context (latest per `section`) + push aggregation into ClickHouse (never raw rows — `windowFunnel`, `GROUP BY`, never `SELECT `* into the LLM) → interpret with LLM → cross-reference known-issues log → cut by device/geo/segment → write `insights` row → log to Langfuse. |
| 6–7  | Implement confidence methodology (sample size, effect size, known-issue cross-match) — apply it, don't just have the LLM state a number.                                                                                                                                                                         |
| 7–8  | Test real analytics questions against Person A's instrumented tables (e.g. "does Express lift checkout conversion, cut by OS" against real generated table).                                                                                                                                                     |
| 8–9  | Unseen-spec dry run: full chain — Instrumentation creates table → Context Agent updates → Analytics Agent produces insight — all traced.                                                                                                                                                                         |
| 9–10 | Prompt polish, graceful handling of thin/ambiguous evidence (don't force false confidence).                                                                                                                                                                                                                      |


### Person C — Tracing, LibreChat wiring, Dashboard


| Hour | Task                                                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0–1  | Langfuse Cloud project set up; tagging convention finalized; ship the `traced_run` wrapper — this blocks A and B, do it first.                                                                               |
| 1–2  | Stand up LibreChat, wire "ask a question" and "submit a spec" as tool calls into the agent server. Default UI, no theming.                                                                                   |
| 2–5  | Build the lightweight custom dashboard (separate small app) reading `agent_meta` directly: schema-changes-over-time, insights feed with confidence + "view full trace →" links, context diff/changelog view. |
| 5–7  | Wire LibreChat's ingestion flow end-to-end to the Instrumentation Agent; wire Q&A to the Analytics Agent; confirm `trace_url` flows through to dashboard rows.                                               |
| 7–8  | Polish: confidence badges, diff rendering, filter by spec/agent/date. Smoke-test both surfaces.                                                                                                              |
| 8–9  | Unseen-spec dry run: confirm dashboard reflects new schema + insight + context entries with correct trace links live.                                                                                        |
| 9–10 | Submission prep: README, and a recorded backup walkthrough in case the live demo flakes.                                                                                                                     |


---

## Cross-team checkpoints (all 3, brief sync, don't let these slip)

- **Hour 1:** contracts locked — `agent_meta` schema, `perf_tool` signature, `traced_run` wrapper all exist, even if empty-bodied.
- **Hour 3:** `perf_tool` and tracing wrapper functional — A and B can now integrate for real.
- **Hour 6:** first true end-to-end pass on one known spec, touched by all three components.
- **Hour 8:** full dry run treating a held-back spec as "unseen" — this is the dress rehearsal for the real Day-2 drop. Non-negotiable, don't skip this to keep building features.
- **Hour 9–10:** buffer only. No new features after hour 9.

## If you're behind schedule, cut in this order

1. Dashboard visual polish → fall back to structured CLI/table output (explicitly allowed).
2. `perf_tool` candidate breadth → drop to exactly 2 candidates (naive baseline vs. proposed), not an exploration sweep.
3. LibreChat spec-ingestion UI → fall back to a script/CLI trigger for the Instrumentation Agent.

## Never cut

- Langfuse tracing (directly judged — "no trace, no credit").
- Context versioning with rationale + confidence (directly judged — "context freshness").
- The hour-8 unseen-spec dry run.

