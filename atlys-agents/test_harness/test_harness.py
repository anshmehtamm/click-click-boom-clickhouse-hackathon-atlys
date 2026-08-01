"""Correctness gate for a proposed schema — the second gate before `executed`
(perf_tool proves fast, this proves correct), and the one that makes the suite
cumulative: every proposal's smoke tests get persisted in `agent_meta.test_cases`
and re-run on every subsequent proposal, so a rework round can't silently break a
table built earlier.

Reuses perf_tool's scratch-table pattern for the pre-execution checks — never
touches production (`atlys.*`) tables until the caller has already decided to execute.
"""
from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field

from agent_meta.db import get_client
from perf_tool import parse_column_names


@dataclass
class TestResult:
    description: str
    test_type: str
    query: str
    passed: bool
    actual: str
    duration_ms: float


@dataclass
class TestSuiteResult:
    passed: bool
    results: list[TestResult] = field(default_factory=list)


def build_smoke_queries(table_name: str, columns_ddl: str, pm_question_queries: list[tuple[str, str]] | None = None) -> list[tuple[str, str]]:
    """Generic smoke queries every table gets, plus any spec-specific ones the
    caller derived from the spec's "questions the PM will ask" section."""
    cols = set(parse_column_names(columns_ddl))
    queries = [("row count is non-zero", f"SELECT count() FROM {{table}}")]
    if "user_id" in cols:
        queries.append(("distinct users countable", f"SELECT uniqExact(user_id) FROM {{table}}"))
    if "device_type" in cols:
        queries.append(("segment breakdown by device_type", f"SELECT device_type, count() FROM {{table}} GROUP BY device_type"))
    if pm_question_queries:
        queries.extend(pm_question_queries)
    return queries


def run_new_table_tests(
    table_name: str,
    columns_ddl: str,
    ordering_key: str,
    partition_key: str,
    sample_rows: list[dict],
    smoke_queries: list[tuple[str, str]],
    scratch_db: str = "atlys_staging",
) -> TestSuiteResult:
    client = get_client(database="default")
    client.command(f"CREATE DATABASE IF NOT EXISTS {scratch_db}")
    scratch_table = f"{scratch_db}.{table_name}__testharness__{uuid.uuid4().hex[:6]}"
    results: list[TestResult] = []

    try:
        client.command(f"DROP TABLE IF EXISTS {scratch_table}")
        client.command(
            f"CREATE TABLE {scratch_table} ({columns_ddl}) "
            f"ENGINE = MergeTree PARTITION BY {partition_key} ORDER BY {ordering_key} "
            f"SETTINGS allow_nullable_key = 1"
        )

        # --- insert_integrity ---
        t0 = time.perf_counter()
        body = "\n".join(json.dumps(r, default=str) for r in sample_rows).encode("utf-8")
        client.raw_insert(
            scratch_table, insert_block=body, fmt="JSONEachRow",
            settings={"input_format_skip_unknown_fields": 1},
        )
        actual_count = client.query(f"SELECT count() FROM {scratch_table}").result_rows[0][0]
        elapsed = (time.perf_counter() - t0) * 1000
        passed = actual_count == len(sample_rows)
        results.append(TestResult(
            description=f"insert integrity: {len(sample_rows)} rows in -> {actual_count} rows landed",
            test_type="insert_integrity", query=f"INSERT INTO {table_name} ... ({len(sample_rows)} rows)",
            passed=passed, actual=f"{actual_count} rows", duration_ms=round(elapsed, 2),
        ))

        # --- query_smoke ---
        for description, query_template in smoke_queries:
            q = query_template.format(table=scratch_table)
            t0 = time.perf_counter()
            try:
                r = client.query(q)
                elapsed = (time.perf_counter() - t0) * 1000
                results.append(TestResult(
                    description=description, test_type="query_smoke", query=q,
                    passed=True, actual=f"ok, {r.row_count} rows returned", duration_ms=round(elapsed, 2),
                ))
            except Exception as e:
                elapsed = (time.perf_counter() - t0) * 1000
                results.append(TestResult(
                    description=description, test_type="query_smoke", query=q,
                    passed=False, actual=f"ERROR: {e}", duration_ms=round(elapsed, 2),
                ))
    finally:
        client.command(f"DROP TABLE IF EXISTS {scratch_table}")

    return TestSuiteResult(passed=all(r.passed for r in results), results=results)


def register_tests(proposal_id: str, table_name: str, smoke_queries: list[tuple[str, str]]):
    """Persist this proposal's smoke tests so future proposals' regression runs include
    them. Query is stored with the real table_name substituted (not the scratch name),
    since after execution these run against the production `atlys.{table_name}`."""
    client = get_client(database="agent_meta")
    rows = [
        [str(uuid.uuid4()), proposal_id, table_name, "query_smoke",
         q.format(table=f"atlys.{table_name}"), "no_error", description]
        for description, q in smoke_queries
    ]
    client.insert(
        "test_cases", rows,
        column_names=["test_id", "introduced_by_proposal_id", "table_name", "test_type", "query", "expected", "description"],
    )


def run_regression_suite(proposal_id: str, trace_url: str = "") -> TestSuiteResult:
    """Re-run every accumulated test in agent_meta.test_cases (across every table
    instrumented so far, not just the one just added) against the current, real state
    of `atlys`. This is what catches a rework round breaking something built earlier."""
    meta_client = get_client(database="agent_meta")
    data_client = get_client(database="atlys")
    test_cases = meta_client.query(
        "SELECT test_id, table_name, query, expected, description FROM test_cases"
    ).result_rows

    results: list[TestResult] = []
    run_rows = []
    for test_id, table_name, query, expected, description in test_cases:
        t0 = time.perf_counter()
        try:
            data_client.query(query)
            elapsed = (time.perf_counter() - t0) * 1000
            passed, actual = True, "ok"
        except Exception as e:
            elapsed = (time.perf_counter() - t0) * 1000
            passed, actual = False, f"ERROR: {e}"
        results.append(TestResult(description, "query_smoke", query, passed, actual, round(elapsed, 2)))
        run_rows.append([str(uuid.uuid4()), proposal_id, test_id, 1 if passed else 0, actual, int(elapsed), trace_url])

    if run_rows:
        meta_client.insert(
            "test_runs", run_rows,
            column_names=["run_id", "proposal_id", "test_id", "passed", "actual", "duration_ms", "trace_url"],
        )

    return TestSuiteResult(passed=all(r.passed for r in results), results=results)
