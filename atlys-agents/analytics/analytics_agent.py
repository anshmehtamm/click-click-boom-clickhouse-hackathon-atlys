"""Analytics Agent — genuine multi-turn exploration, not pre-baked seed queries.

Design (revised): the orchestrator does NOT run deterministic "seed queries" or
pre-fetch context sections anymore. That approach silently produced wrong numbers
whenever a table's shape didn't match the seed queries' baked-in assumptions — a
real run computed a 0.0% "feature adoption rate" for a table whose feature actors
are keyed by `share_id`, not `user_id`, because the generic seed query joined on
the wrong column and nobody (query or LLM) caught it until manual inspection.

Instead, the LibreChat analytics agent gets a minimal payload (spec_name,
table_name, database, spec_markdown) and does everything itself via its own MCP
tools: load the `context-engine` skill, explore context sections, inspect the
table's real shape, then answer the spec's PM questions one by one with queries it
writes itself — genuinely agentic, not templated. It's the same tool-loop pattern
already used by the proposer/reviewer/chronicler agents.

Output changed too: instead of a JSON evidence blob the dashboard renders into
fixed chart components, the agent now writes a complete, self-contained HTML
report (see ANALYTICS_AGENT in agents/prompts.py for the exact structure it's
told to produce) — persisted alongside the summary fields so a list view can show
the short version and link out to the full report.

One deterministic check remains: a bare `SELECT count()` for the orchestrator's
hard small-n confidence cap. This carries no interpretive assumption about how
the table is keyed (unlike the old seed queries), so it doesn't reintroduce the
failure mode being removed here — it's a safety net, not evidence handed to the LLM.
"""
from __future__ import annotations

import json
import os
import uuid

from agent_meta.db import get_client

# Import shared agent helpers from their own module to avoid a circular import
# (pipeline.py lazily imports analytics_agent; analytics_agent must not import
# pipeline at module load time or the cycle breaks when the lazy import is hoisted).
from orchestrator.agent_io import AgentOutputError, _call_json_agent


def _total_row_count(table_name: str) -> int:
    """Bare row count, purely for the orchestrator's hard confidence cap below —
    NOT handed to the LLM as evidence. No join, no assumption about how the table
    is keyed, so this can't produce the wrong-join-key failure mode the old seed
    queries had."""
    client = get_client(database="atlys")
    try:
        return client.query(f"SELECT count() FROM atlys.{table_name}").result_rows[0][0]
    except Exception:
        return 0


def _call_analytics(run, spec_name: str, table_name: str, spec_markdown: str) -> dict:
    """Calls the LibreChat analytics agent with a minimal payload. The agent loops
    via its own MCP tools (context-engine skill, list_context_sections/
    lookup_context, describe_table, run_query, execute_python) to explore the
    table and answer the spec's PM questions, then returns the final structured
    JSON including a full HTML report."""
    payload = {
        "trigger": "new_table_executed",
        "spec_name": spec_name,
        "table_name": table_name,
        "database": "atlys",
        # Full spec, not truncated — the "Questions the PM will ask" section is
        # what the agent works through one by one, and truncating risks cutting
        # it off for a longer spec.
        "spec_markdown": spec_markdown,
        "instruction": (
            "A new feature table has just been instrumented into ClickHouse. "
            "Follow your system prompt's stages in order: load context-engine "
            "first, understand this table's real shape before querying it, "
            "answer the spec's PM questions one by one with your own queries, "
            "correlate with known issues, then write the full HTML report."
        ),
    }
    result, _r = _call_json_agent(
        "analytics_agent", payload, run, "analytics",
        required_keys=["title", "summary", "confidence", "report_html"],
        reasoning_fn=lambda parsed: parsed.get("summary"),
        spec_name=spec_name, table_name=table_name,
    )
    return result


def _write_insight(meta_client, spec_name: str, analysis: dict, trace_url: str) -> str:
    insight_id = str(uuid.uuid4())
    known_issues_raw = analysis.get("related_known_issues", [])
    ki_serialized = [
        json.dumps(ki) if isinstance(ki, dict) else str(ki)
        for ki in known_issues_raw
    ]

    meta_client.insert(
        "insights",
        [[
            insight_id, spec_name,
            analysis.get("title", ""),
            analysis.get("summary", ""),
            analysis.get("segment_cuts", []),
            json.dumps({"confidence_drivers": analysis.get("confidence_drivers", "")}),
            ki_serialized,
            float(analysis.get("confidence", 0.0)),
            trace_url,
            analysis.get("report_html", ""),
        ]],
        column_names=["insight_id", "spec_name", "title", "summary",
                      "segment_cuts", "evidence", "related_known_issues",
                      "confidence", "trace_url", "report_html"],
    )
    return insight_id


def run_analytics(run, spec_name: str, table_name: str, spec_markdown: str,
                  meta_client) -> dict | None:
    """Full analytics loop: call the analytics agent (which explores and queries
    entirely on its own) → persist the insight + HTML report. Returns the insight
    dict or None if the agent isn't configured."""
    if not os.environ.get("OPENAI_API_KEY"):
        run.log(step="analytics_skipped", input=None,
                output="OPENAI_API_KEY not set — skipping analytics")
        return None

    total_events = _total_row_count(table_name)
    run.log(step="small_n_gate", input=None,
            output={"total_events": total_events, "sparse": total_events < 100})

    with run.span("analytics_explore"):
        try:
            analysis = _call_analytics(run, spec_name, table_name, spec_markdown)
        except AgentOutputError as e:
            run.log(step="analytics_json_error", input=e.raw_text[:1000], output=str(e.parse_error))
            return None

    # Hard small-n confidence cap — the LLM's confidence is advisory, this is enforced.
    # Prompts alone don't reliably gate confidence; make it deterministic.
    if total_events < 100 and analysis.get("confidence", 0) > 0.5:
        analysis["confidence"] = 0.5
        analysis["confidence_drivers"] = (
            f"[capped by orchestrator] total_feature_events={total_events} (<100); "
            + analysis.get("confidence_drivers", "")
        )
        run.log(step="confidence_capped", input=None,
                output={"total_events": total_events, "capped_to": 0.5})

    with run.span("analytics_persist"):
        insight_id = _write_insight(meta_client, spec_name, analysis, run.url)
        run.log(step="insight_written", input=None,
                output={"insight_id": insight_id, "confidence": analysis.get("confidence"),
                        "title": analysis.get("title", "")[:120]})

    analysis["insight_id"] = insight_id
    analysis["trace_url"] = run.url
    return analysis
