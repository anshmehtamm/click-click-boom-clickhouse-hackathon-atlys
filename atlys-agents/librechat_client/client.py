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
    usage: dict[str, int] = field(default_factory=dict)


def _base_url() -> str:
    return os.environ["LIBRECHAT_URL"].rstrip("/")


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {os.environ['LIBRECHAT_API_KEY']}",
        "Content-Type": "application/json",
    }


def call_agent(agent_id: str, input_text: str, timeout: int = 120) -> AgentResult:
    """Calls a LibreChat agent (non-streaming) and returns its final text plus any
    tool calls it made, for unpacking into Langfuse child spans by the caller."""
    resp = requests.post(
        f"{_base_url()}/api/agents/v1/responses",
        headers=_headers(),
        json={"model": agent_id, "input": input_text},
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

    # Extract token usage from the response
    usage_data = data.get("usage", {})
    usage = {
        "input": usage_data.get("prompt_tokens", 0),
        "output": usage_data.get("completion_tokens", 0),
        "total": usage_data.get("total_tokens", 0),
    }

    return AgentResult(
        output_text="\n".join(output_text_parts).strip(),
        tool_calls=tool_calls,
        raw=data,
        usage=usage,
    )


def smoke_test(agent_id: str) -> AgentResult:
    """Minimal round-trip check — call this first against any newly created agent."""
    return call_agent(agent_id, "Reply with exactly the word: pong")
