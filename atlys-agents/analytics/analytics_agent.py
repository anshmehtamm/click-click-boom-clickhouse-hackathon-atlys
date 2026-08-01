"""Analytics Agent — the query→interpret→drill→correlate→write loop.

Design: the orchestrator runs deterministic seed queries (small result sets),
fetches relevant context sections, then calls the LibreChat analytics agent
ONCE with that pre-computed evidence. The LibreChat agent then loops via its
MCP tools (run_query for drills, lookup_context for known-issue checks) and
produces the final structured JSON.

ClickHouse computes, the LLM interprets. No raw row dumps ever reach the LLM.
Every query result is logged as a Langfuse span so each number in the insight
traces back to the query that produced it.
"""
from __future__ import annotations

import json
import os
import uuid

from agent_meta.db import get_client
from librechat_client import call_agent

# Import shared agent helpers from their own module to avoid a circular import
# (pipeline.py lazily imports analytics_agent; analytics_agent must not import
# pipeline at module load time or the cycle breaks when the lazy import is hoisted).
from orchestrator.agent_io import AgentOutputError, _call_json_agent, _log_agent_call

# ── context sections the analytics agent always needs ───────────────────────

_REQUIRED_CONTEXT_SECTIONS = [
    "metric:conversion_rate",
    "metric:drop_off_rate",
    "metric:step_through_rate",
    "metric:on_time_delivery_rate",   # to KNOW it's uncomputable — don't fabricate
    "metric:revenue_per_conversion",
    "relationship:join_map",
    "issue:K1", "issue:K2", "issue:K3", "issue:K4",
    "issue:K5", "issue:K6", "issue:K7",
    "convention:funnel_analysis",
    "convention:segment_cuts",
    "dataquality:envelope",
    "overview:business",
]


def _fetch_context(table_name: str) -> dict[str, str]:
    """Pull the required context sections from agent_meta.current_context.
    Returns {section_key: content_json_string}. Adds the new table's section
    dynamically so the agent knows the Chronicler's grain/join-key description."""
    client = get_client(database="agent_meta")
    sections = _REQUIRED_CONTEXT_SECTIONS + [f"table:{table_name}"]
    # Use tuple string-formatting (not parameter binding) — the team confirmed
    # clickhouse-connect's IN %(x)s binding is unreliable for list params; the
    # existing smoke_test_agents.py uses this same pattern.
    sections_tuple = tuple(sections)
    rows = client.query(
        f"SELECT section, content FROM current_context WHERE section IN {sections_tuple}",
    ).result_rows
    return {row[0]: row[1] for row in rows}


# ── seed query templates ─────────────────────────────────────────────────────
# Each returns a small result set (< 50 rows). Parameterized by table name.
# These run deterministically in the orchestrator; results are handed to the
# LLM as pre-computed evidence. The LLM then decides which additional drill
# queries to run via its run_query MCP tool.

def _q_sample_size(table: str) -> str:
    """Always first: count per event type + unique users — the small-n gate."""
    return (
        f"SELECT COALESCE(event_type, 'all_events') AS event_type, "
        f"count() AS n, uniqExact(user_id) AS unique_users "
        f"FROM atlys.{table} GROUP BY event_type ORDER BY n DESC LIMIT 20"
    )


def _q_feature_adoption(table: str) -> str:
    """Of all users who started an application, how many used this feature."""
    return (
        f"SELECT uniqExact(f.user_id) AS feature_users, "
        f"uniqExact(a.user_id) AS all_started_users, "
        f"round(uniqExact(f.user_id) / greatest(uniqExact(a.user_id), 1), 4) AS adoption_rate "
        f"FROM atlys.application_started a "
        f"LEFT JOIN (SELECT DISTINCT user_id FROM atlys.{table}) f USING (user_id)"
    )


def _q_feature_vs_baseline_conversion(table: str) -> str:
    """Feature users vs non-feature users: conversion to purchase_completed."""
    return (
        f"SELECT if(f.user_id != '', 'feature', 'standard') AS cohort, "
        f"uniqExact(a.user_id) AS started, "
        f"uniqExactIf(pc.user_id, pc.user_id != '') AS converted, "
        f"round(uniqExactIf(pc.user_id, pc.user_id != '') / greatest(uniqExact(a.user_id), 1), 4) AS conv_rate "
        f"FROM atlys.application_started a "
        f"LEFT JOIN atlys.purchase_completed pc USING (application_id) "
        f"LEFT JOIN (SELECT DISTINCT user_id FROM atlys.{table}) f USING (user_id) "
        f"GROUP BY cohort ORDER BY cohort"
    )


def _q_segment_breakdown(table: str) -> str:
    """Feature usage by device_type / os / geoip_country_code — always cut these."""
    return (
        f"SELECT device_type, os, geoip_country_code, "
        f"count() AS n, uniqExact(user_id) AS unique_users "
        f"FROM atlys.{table} "
        f"GROUP BY device_type, os, geoip_country_code ORDER BY n DESC LIMIT 30"
    )


def _q_existing_funnel_baseline() -> str:
    """Current funnel step sizes — gives context for adoption/conversion numbers."""
    return (
        "SELECT 'destination_card_clicked' AS step, uniqExact(user_id) AS users "
        "FROM atlys.destination_card_clicked "
        "UNION ALL SELECT 'application_started', uniqExact(user_id) FROM atlys.application_started "
        "UNION ALL SELECT 'document_uploaded', uniqExact(user_id) FROM atlys.document_uploaded "
        "UNION ALL SELECT 'purchase_completed', uniqExact(user_id) FROM atlys.purchase_completed"
    )


def _q_destination_mix(table: str) -> str:
    """Top destinations in the feature table — cross-reference with K4 (Schengen)."""
    return (
        f"SELECT destination, count() AS n, uniqExact(user_id) AS users "
        f"FROM atlys.{table} GROUP BY destination ORDER BY n DESC LIMIT 15"
    )


# ── query runner ─────────────────────────────────────────────────────────────

def _run_seed_queries(run, table_name: str) -> dict[str, dict]:
    """Run all seed queries. Returns {query_name: {sql, rows, n}} where n is
    the total row count / user count from the result (for small-n gating)."""
    ch = get_client(database="atlys")
    results: dict[str, dict] = {}

    queries = {
        "sample_size":              _q_sample_size(table_name),
        "feature_adoption":         _q_feature_adoption(table_name),
        "feature_vs_baseline_cvr":  _q_feature_vs_baseline_conversion(table_name),
        "segment_breakdown":        _q_segment_breakdown(table_name),
        "funnel_baseline":          _q_existing_funnel_baseline(),
        "destination_mix":          _q_destination_mix(table_name),
    }

    for name, sql in queries.items():
        with run.span(f"compute_{name}"):
            try:
                result = ch.query(sql)
                rows = result.result_rows
                cols = result.column_names
                # Convert to list-of-dicts for readability
                rows_as_dicts = [dict(zip(cols, row)) for row in rows]
                # Cap at 50 rows before handing to LLM
                rows_as_dicts = rows_as_dicts[:50]
                total_n = sum(r.get("n", r.get("unique_users", 1)) for r in rows_as_dicts) if rows_as_dicts else 0
                results[name] = {"sql": sql.strip(), "rows": rows_as_dicts, "n": int(total_n)}
                run.log(step=f"compute_{name}_result", input=sql.strip(),
                        output={"rows_returned": len(rows_as_dicts), "n": int(total_n), "preview": rows_as_dicts[:5]})
            except Exception as e:
                results[name] = {"sql": sql.strip(), "rows": [], "n": 0, "error": str(e)}
                run.log(step=f"compute_{name}_error", input=sql.strip(), output=str(e))

    return results


# ── analytics call ───────────────────────────────────────────────────────────

def _call_analytics(run, spec_name: str, table_name: str, spec_markdown: str,
                    seed_results: dict, context: dict) -> dict:
    """Calls the LibreChat analytics agent with pre-computed evidence + context.
    The agent then loops via its MCP tools (run_query for drills, lookup_context
    for known-issue verification) and returns the final structured JSON."""
    payload = {
        "trigger": "new_table_executed",
        "spec_name": spec_name,
        "table_name": table_name,
        "database": "atlys",
        # Cap spec markdown to 2500 chars — PM questions section is what matters
        "spec_summary": spec_markdown[:2500],
        "pre_computed_queries": seed_results,
        "context_sections": context,
        "instruction": (
            "A new feature table has just been instrumented into ClickHouse. "
            "Analyze the pre-computed query results above, then use your tools to "
            "drill into anomalies and verify known-issue matches. "
            "Produce a PM-facing insight following your system prompt's loop."
        ),
    }
    result, r = _call_json_agent(os.environ["LIBRECHAT_AGENT_ANALYTICS"], payload)
    _log_agent_call(run, "analytics", payload, r, spec_name=spec_name, table_name=table_name)
    return result


# ── persistence ──────────────────────────────────────────────────────────────

def _write_insight(meta_client, spec_name: str, analysis: dict,
                   seed_results: dict, trace_url: str) -> str:
    insight_id = str(uuid.uuid4())
    known_issues_raw = analysis.get("related_known_issues", [])
    ki_serialized = [
        json.dumps(ki) if isinstance(ki, dict) else str(ki)
        for ki in known_issues_raw
    ]

    # Store evidence as {llm: agent_evidence, chart_data: seed_rows} so the
    # dashboard can render deterministic charts from ClickHouse result sets
    # rather than trying to parse the LLM's free-text key_numbers strings.
    chart_data = {
        name: {"rows": r.get("rows", []), "n": r.get("n", 0)}
        for name, r in seed_results.items()
        if r.get("rows")
    }
    evidence_json = json.dumps({
        "llm": analysis.get("evidence", {}),
        "chart_data": chart_data,
    })

    meta_client.insert(
        "insights",
        [[
            insight_id, spec_name,
            analysis.get("title", ""),
            analysis.get("summary", ""),
            analysis.get("segment_cuts", []),
            evidence_json,
            ki_serialized,
            float(analysis.get("confidence", 0.0)),
            trace_url,
        ]],
        column_names=["insight_id", "spec_name", "title", "summary",
                      "segment_cuts", "evidence", "related_known_issues",
                      "confidence", "trace_url"],
    )
    return insight_id


# ── main entry point ─────────────────────────────────────────────────────────

def run_analytics(run, spec_name: str, table_name: str, spec_markdown: str,
                  meta_client) -> dict | None:
    """Full analytics loop: fetch context → run seed queries → call analytics
    agent → persist insight. Returns the insight dict or None if agent unavailable."""
    agent_id = os.environ.get("LIBRECHAT_AGENT_ANALYTICS")
    if not agent_id:
        run.log(step="analytics_skipped", input=None,
                output="LIBRECHAT_AGENT_ANALYTICS not set — skipping analytics")
        return None

    with run.span("analytics_context"):
        context = _fetch_context(table_name)
        run.log(step="context_fetched", input=None,
                output={"sections_found": list(context.keys()), "n_sections": len(context)})

    seed_results = _run_seed_queries(run, table_name)

    # Small-n check: surface it prominently so the agent gets the signal
    sample_size_rows = seed_results.get("sample_size", {}).get("rows", [])
    total_events = sum(r.get("n", 0) for r in sample_size_rows)
    unique_users = max((r.get("unique_users", 0) for r in sample_size_rows), default=0)
    run.log(step="small_n_gate", input=None,
            output={"total_events": total_events, "max_unique_users": unique_users,
                    "sparse": total_events < 100})

    with run.span("analytics_interpret"):
        try:
            analysis = _call_analytics(run, spec_name, table_name, spec_markdown,
                                       seed_results, context)
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
        insight_id = _write_insight(meta_client, spec_name, analysis, seed_results, run.url)
        run.log(step="insight_written", input=None,
                output={"insight_id": insight_id, "confidence": analysis.get("confidence"),
                        "title": analysis.get("title", "")[:120]})

    return {**analysis, "insight_id": insight_id}
