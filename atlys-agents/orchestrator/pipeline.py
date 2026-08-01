"""The centerpiece: drives one spec through
drafted -> pending_review -> [needs_rework loop, capped] -> approved
  -> [test harness] -> executed -> [context commit]
as a single Langfuse trace with nested spans.

Design rule, consistent throughout: this module owns all deterministic work
(ClickHouse reads/writes, perf_tool, test_harness, the state machine, the revision
cap) and calls the 4 LibreChat agents only for the reasoning steps, handing each one
pre-computed evidence as input rather than trusting it to fetch/compute things itself.
"""
from __future__ import annotations

import json
import os
import uuid

from agent_meta.db import get_client
from librechat_client import call_agent
from perf_tool import Candidate, run_perf_test
from test_harness import build_smoke_queries, register_tests, run_new_table_tests, run_regression_suite
from tracing import traced_run

MAX_REVISIONS = 2


def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


def _get_nested(d: dict, dotted_key: str):
    cur = d
    for part in dotted_key.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def _flatten_events(events: list[dict], column_mapping: dict[str, str]) -> list[dict]:
    """Raw events can have nested objects (e.g. Express Checkout's `payment.amount`).
    column_mapping (from the proposer) tells us how to flatten them into the columns
    the DDL actually declares. Top-level scalar fields also pass through unchanged so
    envelope columns (id, timestamp, user_id, ...) work even if the agent didn't
    enumerate every single one in column_mapping — unmapped/unused keys are silently
    dropped by ClickHouse's input_format_skip_unknown_fields on insert."""
    flat = []
    for e in events:
        row = {k: v for k, v in e.items() if not isinstance(v, dict)}
        for raw_key, col_name in column_mapping.items():
            row[col_name] = _get_nested(e, raw_key)
        flat.append(row)
    return flat


def get_current_context() -> list[dict]:
    client = get_client(database="agent_meta")
    rows = client.query("SELECT section, content, confidence FROM current_context ORDER BY section").result_rows
    return [{"section": s, "content": json.loads(c), "confidence": conf} for s, c, conf in rows]


def _write_proposal(client, **kwargs) -> str:
    proposal_id = str(uuid.uuid4())
    row = {
        "proposal_id": proposal_id, "parent_proposal_id": None, "revision": 0,
        "spec_name": "", "table_name": "", "ddl": "", "ordering_key": "", "partition_key": "",
        "materialized_views": [], "perf_report": "", "confidence": 0.0, "rationale": "",
        "status": "drafted", "trace_url": "",
        **kwargs,
    }
    cols = list(row.keys())
    client.insert("schema_proposals", [[row[c] for c in cols]], column_names=cols)
    return proposal_id


def _update_proposal_status(client, proposal_id: str, **fields):
    # append-only table: write a fresh row carrying the new status forward.
    prior = client.query(
        "SELECT parent_proposal_id, revision, spec_name, table_name, ddl, ordering_key, partition_key, "
        "materialized_views, perf_report, confidence, rationale, status, trace_url "
        "FROM schema_proposals WHERE proposal_id = %(pid)s ORDER BY ts DESC LIMIT 1",
        parameters={"pid": proposal_id},
    ).result_rows[0]
    keys = ["parent_proposal_id", "revision", "spec_name", "table_name", "ddl", "ordering_key", "partition_key",
            "materialized_views", "perf_report", "confidence", "rationale", "status", "trace_url"]
    row = dict(zip(keys, prior))
    row.update(fields)
    row["proposal_id"] = proposal_id
    cols = list(row.keys())
    client.insert("schema_proposals", [[row[c] for c in cols]], column_names=cols)


def _write_review(client, proposal_id: str, revision: int, review: dict, sections_used: list[str], trace_url: str) -> str:
    review_id = str(uuid.uuid4())
    client.insert(
        "schema_reviews",
        [[review_id, proposal_id, revision, review["verdict"], json.dumps(review["findings"]),
          sections_used, float(review.get("reviewer_confidence", 0.5)), trace_url]],
        column_names=["review_id", "proposal_id", "revision", "verdict", "findings",
                       "context_sections_used", "reviewer_confidence", "trace_url"],
    )
    return review_id


def _write_context_sections(client, sections: list[dict], trace_url: str):
    rows = []
    for s in sections:
        after_json = json.dumps({k: s.get(k) for k in ("title", "summary", "body", "fields", "sources")})
        rows.append([
            str(uuid.uuid4()), s["section"], s.get("before", ""), after_json,
            s.get("diff_summary", ""), s.get("rationale", ""), "chronicle",
            float(s.get("confidence", 0.7)), trace_url,
        ])
    if rows:
        client.insert(
            "context_versions", rows,
            column_names=["version_id", "section", "before", "after", "diff_summary", "rationale", "trigger", "confidence", "trace_url"],
        )


def _build_perf_query_patterns(columns_ddl: str) -> list[str]:
    from perf_tool import parse_column_names
    cols = set(parse_column_names(columns_ddl))
    patterns = ["SELECT count() FROM {table}"]
    if "user_id" in cols:
        patterns.append("SELECT uniqExact(user_id) FROM {table}")
    for candidate_col in ("event_type", "device_type"):
        if candidate_col in cols:
            patterns.append(f"SELECT {candidate_col}, count() FROM {{table}} GROUP BY {candidate_col}")
            break
    return patterns


def _propose(run, spec_name: str, spec_markdown: str, sample_events: list[dict], prior_findings: list[dict] | None) -> dict:
    payload = {"spec_markdown": spec_markdown, "sample_events": sample_events}
    if prior_findings:
        payload["revise_to_address"] = prior_findings
    r = call_agent(os.environ["LIBRECHAT_AGENT_INSTRUMENTATION_PROPOSER"], json.dumps(payload))
    run.log(step="propose", input=payload, output=r.output_text[:2000])
    return _extract_json(r.output_text)


def _review(run, proposal: dict, context: list[dict]) -> dict:
    payload = {"proposal": proposal, "current_context": context}
    r = call_agent(os.environ["LIBRECHAT_AGENT_CONTEXT_REVIEWER"], json.dumps(payload))
    run.log(step="review", input={"proposal": proposal}, output=r.output_text[:2000])
    return _extract_json(r.output_text)


def _chronicle(run, executed_proposal: dict, spec_name: str, context: list[dict]) -> dict:
    payload = {"executed_proposal": executed_proposal, "spec_name": spec_name, "current_context": context}
    r = call_agent(os.environ["LIBRECHAT_AGENT_CONTEXT_CHRONICLER"], json.dumps(payload))
    run.log(step="chronicle", input={"table_name": executed_proposal.get("table_name")}, output=r.output_text[:2000])
    return _extract_json(r.output_text)


def ingest_spec(spec_name: str, spec_markdown: str, sample_events: list[dict], pm_question_queries: list[tuple[str, str]] | None = None) -> dict:
    """Runs one feature spec through the full pipeline. Returns a summary dict with
    the final status, proposal_id, table_name, and the Langfuse trace_url that proves
    this all came from the pipeline, not a human."""
    meta_client = get_client(database="agent_meta")

    with traced_run(agent="pipeline", spec=spec_name) as run:
        revision = 0
        prior_findings = None
        proposal_id = None
        final_proposal = None
        final_review = None

        while True:
            draft = _propose(run, spec_name, spec_markdown, sample_events, prior_findings)
            flattened_events = _flatten_events(sample_events, draft.get("column_mapping", {}))

            with run.span("perf_evaluation", revision=revision):
                candidates = [
                    Candidate(label=c["label"], ordering_key=c["ordering_key"], partition_key=c.get("partition_key", "toYYYYMM(timestamp)"))
                    for c in draft["ordering_key_candidates"]
                ]
                perf_report = run_perf_test(
                    table_name=draft["table_name"],
                    columns_ddl=draft["columns_ddl"],
                    candidates=candidates,
                    sample_source=flattened_events,
                    query_patterns=_build_perf_query_patterns(draft["columns_ddl"]),
                    sample_limit=len(sample_events),
                    include_baseline=True,
                )
                winner = next(c for c in candidates if c.label == perf_report.winner) if perf_report.winner != "baseline_legacy" else candidates[0]
                run.log(step="perf_winner", input=[c.label for c in candidates], output={"winner": winner.label, "speedup": perf_report.speedup_vs_baseline})

            ddl = (
                f"CREATE TABLE {draft['table_name']} ({draft['columns_ddl']}) "
                f"ENGINE = MergeTree PARTITION BY {winner.partition_key} ORDER BY {winner.ordering_key}"
            )
            proposal = {
                "table_name": draft["table_name"], "columns_ddl": draft["columns_ddl"], "ddl": ddl,
                "ordering_key": winner.ordering_key,
                "partition_key": winner.partition_key, "column_mapping": draft.get("column_mapping", {}),
                "materialized_views": draft.get("materialized_views", []),
                "confidence": draft.get("confidence", 0.5),
                "rationale": draft.get("rationale", "") + f" | ordering key chosen by perf_tool: {perf_report.speedup_vs_baseline}x vs legacy baseline.",
            }

            proposal_id = _write_proposal(
                meta_client, spec_name=spec_name, table_name=proposal["table_name"], ddl=proposal["ddl"],
                ordering_key=proposal["ordering_key"], partition_key=proposal["partition_key"],
                materialized_views=proposal["materialized_views"], perf_report=perf_report.to_json(),
                confidence=proposal["confidence"], rationale=proposal["rationale"],
                status="pending_review", revision=revision, trace_url=run.url,
            ) if proposal_id is None else proposal_id
            if revision > 0:
                _update_proposal_status(
                    meta_client, proposal_id, status="pending_review", revision=revision,
                    ddl=proposal["ddl"], ordering_key=proposal["ordering_key"], partition_key=proposal["partition_key"],
                    materialized_views=proposal["materialized_views"], perf_report=perf_report.to_json(),
                    confidence=proposal["confidence"], rationale=proposal["rationale"],
                )

            context = get_current_context()
            review = _review(run, proposal, context)
            _write_review(meta_client, proposal_id, revision, review, review.get("context_sections_used", []), run.url)

            final_proposal, final_review, final_flattened_events = proposal, review, flattened_events
            if review["verdict"] == "approve":
                break
            if revision >= MAX_REVISIONS:
                run.log(step="revision_cap_hit", input={"revision": revision}, output={"proceeding_anyway": True, "unresolved_findings": review["findings"]})
                proposal["confidence"] = min(proposal["confidence"], 0.4)
                break
            revision += 1
            prior_findings = review["findings"]
            _update_proposal_status(meta_client, proposal_id, status="needs_rework", revision=revision)

        _update_proposal_status(meta_client, proposal_id, status="approved")

        with run.span("test_harness"):
            smoke_queries = build_smoke_queries(final_proposal["table_name"], final_proposal["columns_ddl"], pm_question_queries)
            suite = run_new_table_tests(
                table_name=final_proposal["table_name"],
                columns_ddl=final_proposal["columns_ddl"],
                ordering_key=final_proposal["ordering_key"], partition_key=final_proposal["partition_key"],
                sample_rows=final_flattened_events, smoke_queries=smoke_queries,
            )
            run.log(step="test_harness_result", input=None, output={"passed": suite.passed, "results": [r.__dict__ for r in suite.results]})
            if not suite.passed:
                _update_proposal_status(meta_client, proposal_id, status="needs_rework")
                return {"status": "needs_rework", "reason": "test_harness_failed", "proposal_id": proposal_id, "trace_url": run.url, "test_results": [r.__dict__ for r in suite.results]}

        with run.span("execute"):
            data_client = get_client(database="atlys")
            data_client.command(final_proposal["ddl"])
            for mv_sql in final_proposal.get("materialized_views", []):
                data_client.command(mv_sql)
            if final_flattened_events:
                body = "\n".join(json.dumps(r, default=str) for r in final_flattened_events).encode()
                data_client.raw_insert(
                    final_proposal["table_name"], insert_block=body, fmt="JSONEachRow",
                    settings={"input_format_skip_unknown_fields": 1},
                )
            run.log(step="executed", input=None, output={"table": f"atlys.{final_proposal['table_name']}"})

        _update_proposal_status(meta_client, proposal_id, status="executed")
        register_tests(proposal_id, final_proposal["table_name"], smoke_queries)

        with run.span("regression_suite"):
            regression = run_regression_suite(proposal_id, run.url)
            run.log(step="regression_result", input=None, output={"passed": regression.passed, "n_tests": len(regression.results)})

        with run.span("chronicle"):
            context = get_current_context()
            chronicle = _chronicle(run, final_proposal, spec_name, context)
            _write_context_sections(meta_client, chronicle["sections"], run.url)

        return {
            "status": "executed", "proposal_id": proposal_id, "table_name": final_proposal["table_name"],
            "ddl": final_proposal["ddl"], "revisions": revision, "regression_passed": regression.passed,
            "trace_url": run.url,
        }
