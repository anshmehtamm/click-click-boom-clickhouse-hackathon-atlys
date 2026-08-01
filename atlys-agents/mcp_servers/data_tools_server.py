"""Lean, size-capped ClickHouse tools — built to replace the official mcp-clickhouse
server's list_tables/run_query as the agents' default, after measuring that a single
list_tables(database='atlys') call returns ~62,000 chars (~15,500 tokens): full
column metadata (types, comments, codecs) for every table in one response. In a
multi-turn tool-calling loop, every subsequent turn resends the whole growing
conversation, so one oversized call compounds across every later turn in the same
agent invocation — this is what actually drove real runs to ~90-100K input tokens
for a SINGLE agent call (measured via LibreChat's own transaction ledger in Mongo).

Two things fix this:
1. Tools here are narrow and compact by construction (list_tables returns just
   name/engine/row count; describe_table returns columns for ONE table, name+type
   only — no comments/codecs/stats bloat).
2. Anything still large gets offloaded: run_query writes the full result to a
   scratch file and returns a small preview + pointer, with grep_scratch/read_scratch
   tools to inspect the rest without ever pulling it all into context at once.
"""
import json
import pathlib
import re
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from mcp.server import FastMCP

from agent_meta.db import get_client

SCRATCH_DIR = pathlib.Path(__file__).resolve().parent.parent / ".tool_scratch"
SCRATCH_DIR.mkdir(exist_ok=True)

PREVIEW_ROW_LIMIT = 20
PREVIEW_CHAR_LIMIT = 3000

server = FastMCP(
    name="atlys_data", instructions="Read-only, size-capped tools for real Atlys ClickHouse data.",
    host="0.0.0.0", port=8102, stateless_http=True,
)


@server.tool()
def list_tables(database: str = "atlys") -> list[dict]:
    """Lists tables in a database — name, engine, row count only. For column
    details on a SPECIFIC table you already know you need, use describe_table."""
    client = get_client(database=database)
    rows = client.query(
        "SELECT name, engine, total_rows FROM system.tables WHERE database = {db:String} ORDER BY name",
        parameters={"db": database},
    ).result_rows
    return [{"table": n, "engine": e, "row_count": r} for n, e, r in rows]


@server.tool()
def describe_table(table_name: str, database: str = "atlys") -> list[dict]:
    """Column name + type for ONE table. Call this per-table, not in bulk —
    there's no "describe everything" tool on purpose; if you need several tables,
    call this once per table you actually need."""
    client = get_client(database=database)
    rows = client.query(
        "SELECT name, type FROM system.columns WHERE database = {db:String} AND table = {t:String} ORDER BY position",
        parameters={"db": database, "t": table_name},
    ).result_rows
    return [{"column": n, "type": t} for n, t in rows]


@server.tool()
def run_query(query: str, database: str = "atlys") -> dict:
    """Runs a READ-ONLY query (writes rejected server-side). If the result is small
    it's returned inline. If it's large, the FULL result is saved to a scratch file
    and you get a preview + the file path — use grep_scratch/read_scratch to inspect
    the rest instead of asking for it all again. Prefer aggregate queries
    (GROUP BY/count/uniq) over row dumps; add your own LIMIT for exploratory SELECTs."""
    client = get_client(database=database)
    result = client.query(query, settings={"readonly": 1})
    rows = [dict(zip(result.column_names, row)) for row in result.result_rows]
    inline_json = json.dumps({"columns": result.column_names, "rows": rows}, default=str)

    if len(rows) <= PREVIEW_ROW_LIMIT and len(inline_json) <= PREVIEW_CHAR_LIMIT:
        return {"columns": result.column_names, "rows": rows, "row_count": len(rows), "truncated": False}

    # NDJSON — one row per line — is essential here, not cosmetic: grep_scratch and
    # read_scratch operate line-by-line, so a single minified JSON blob (one giant
    # line) would make both tools return the *entire* file regardless of pattern or
    # line range, silently defeating the whole point of offloading to scratch. Caught
    # by actually testing this against a 500-row query before treating it as done.
    scratch_file = SCRATCH_DIR / f"query_{uuid.uuid4().hex[:8]}.ndjson"
    with scratch_file.open("w") as f:
        for row in rows:
            f.write(json.dumps(row, default=str) + "\n")
    total_bytes = scratch_file.stat().st_size
    return {
        "columns": result.column_names,
        "preview_rows": rows[:PREVIEW_ROW_LIMIT],
        "row_count": len(rows),
        "truncated": True,
        "scratch_file": str(scratch_file),
        "hint": f"{len(rows)} total rows saved to scratch_file, one JSON row per line ({total_bytes} bytes). "
        f"Use grep_scratch(scratch_file, pattern) to search it, or read_scratch(scratch_file, start_line, n_lines) to page through it — don't ask for this query again.",
    }


MAX_LINES_RETURNED = 50  # hard cap regardless of what the caller asks for


@server.tool()
def grep_scratch(scratch_file: str, pattern: str, max_matches: int = 30) -> list[str]:
    """Greps a file saved by run_query for a regex pattern, returning matching
    lines only (case-insensitive). Use this instead of read_scratch when you're
    looking for something specific rather than browsing."""
    path = pathlib.Path(scratch_file)
    if not path.is_relative_to(SCRATCH_DIR):
        raise ValueError("scratch_file must be a path returned by run_query")
    regex = re.compile(pattern, re.IGNORECASE)
    matches = [line for line in path.read_text().splitlines() if regex.search(line)]
    return matches[: min(max_matches, MAX_LINES_RETURNED)]


@server.tool()
def read_scratch(scratch_file: str, start_line: int = 0, n_lines: int = 50) -> list[str]:
    """Pages through a file saved by run_query, n_lines at a time starting at
    start_line. Use this to browse when grep_scratch's pattern search isn't what
    you need."""
    n_lines = min(n_lines, MAX_LINES_RETURNED)
    path = pathlib.Path(scratch_file)
    if not path.is_relative_to(SCRATCH_DIR):
        raise ValueError("scratch_file must be a path returned by run_query")
    lines = path.read_text().splitlines()
    return lines[start_line : start_line + n_lines]


if __name__ == "__main__":
    server.run(transport="streamable-http")
