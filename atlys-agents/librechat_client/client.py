"""Thin wrapper around LibreChat's Agents API (beta).

https://www.librechat.ai/docs/features/agents_api

Uses the Open Responses endpoint (POST /api/agents/v1/responses) — `model` is the
LibreChat agent ID. Response shape follows the Open Responses spec (openresponses.org):
an `output` array of items (message / reasoning / function_call / function_call_output).
NOTE: verify this parsing against a real response the first time the hour-1 smoke test
runs — the beta API's exact item shape hasn't been hand-tested yet, only read from spec.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv()


@dataclass
class AgentResult:
    output_text: str
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)
    response_id: str | None = None
    usage: dict[str, int] = field(default_factory=dict)


def _base_url() -> str:
    return os.environ["LIBRECHAT_URL"].rstrip("/")


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {os.environ['LIBRECHAT_API_KEY']}",
        "Content-Type": "application/json",
    }


def call_agent(agent_id: str, input_text: str, previous_response_id: str | None = None, timeout: int = 120) -> AgentResult:
    """Calls a LibreChat agent (non-streaming) and returns its final text plus any
    tool calls it made, for unpacking into Langfuse child spans by the caller.

    `previous_response_id` is currently NOT USABLE — confirmed by direct testing,
    not assumed. The server mints its own internal conversation ID (a UUID) on the
    first call and stores state under that, but never returns it anywhere in the
    response (not the body, not headers) — `AgentResult.response_id` (the `resp_xxx`
    id) is a different, unrelated identifier. Passing it back 404s with "Conversation
    not found". The only way to get the real ID is reaching into LibreChat's MongoDB
    directly, which is an internal implementation detail, not a stable API contract
    — not something to build pipeline reliability on. This is a real gap in the beta
    API, not something we're doing wrong. Left wired up (accepts the param, sends
    store=True) in case a future LibreChat version actually returns the ID, but the
    orchestrator does not currently pass this — every rework round is a genuinely
    fresh conversation, hence prior_findings + previous_attempt being spelled out
    explicitly in the prompt payload instead of relied on as remembered context."""
    # store=True is required for previous_response_id chaining to work at all — it
    # defaults to False, which silently means nothing is persisted server-side and
    # every previous_response_id lookup 404s. Found by inspecting a real response
    # body (it echoes "store": false) after a first chaining attempt failed.
    payload: dict[str, Any] = {"model": agent_id, "input": input_text, "store": True}
    if previous_response_id:
        payload["previous_response_id"] = previous_response_id
    resp = requests.post(
        f"{_base_url()}/api/agents/v1/responses",
        headers=_headers(),
        json=payload,
        timeout=timeout,
    )
    resp.raise_for_status()
    data = resp.json()

    output_text_parts = []
    tool_calls = []
    for item in data.get("output", []):
        item_type = item.get("type")
        if item_type == "message":
            for c in item.get("content", []):
                if c.get("type") in ("output_text", "text"):
                    output_text_parts.append(c.get("text", ""))
        elif item_type == "function_call":
            tool_calls.append(
                {
                    "name": item.get("name"),
                    "arguments": item.get("arguments"),
                    "call_id": item.get("call_id"),
                }
            )
        elif item_type == "function_call_output":
            for tc in tool_calls:
                if tc.get("call_id") == item.get("call_id"):
                    tc["output"] = item.get("output")

    # Extract token usage from the response. Field names verified against a real
    # captured response body, not OpenAI Chat Completions convention (which this
    # isn't) — Open Responses uses input_tokens/output_tokens/total_tokens, not
    # prompt_tokens/completion_tokens.
    usage_data = data.get("usage", {})
    usage = {
        "input": usage_data.get("input_tokens", 0),
        "output": usage_data.get("output_tokens", 0),
        "total": usage_data.get("total_tokens", 0),
    }

    return AgentResult(
        output_text="\n".join(output_text_parts).strip(),
        tool_calls=tool_calls,
        raw=data,
        response_id=data.get("id"),
        usage=usage,
    )


def smoke_test(agent_id: str) -> AgentResult:
    """Minimal round-trip check — call this first against any newly created agent."""
    return call_agent(agent_id, "Reply with exactly the word: pong")
