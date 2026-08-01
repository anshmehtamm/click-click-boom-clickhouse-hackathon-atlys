"""Shared agent I/O helpers — imported by both pipeline.py and analytics_agent.py.

Extracted into a neutral module so neither file creates a circular import by
depending on the other. pipeline.py lazily imports analytics_agent; analytics_agent
must not import pipeline at module load time.
"""
from __future__ import annotations

import json

from librechat_client import call_agent


class AgentOutputError(Exception):
    """Raised when an agent's final message isn't valid JSON."""

    def __init__(self, raw_text: str, parse_error: Exception):
        self.raw_text = raw_text
        self.parse_error = parse_error
        super().__init__(f"Agent output was not valid JSON: {parse_error}")


def _extract_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    try:
        return json.loads(cleaned.strip())
    except json.JSONDecodeError as e:
        raise AgentOutputError(text, e) from e


def _call_json_agent(agent_id: str, payload: dict) -> tuple[dict, object]:
    """Calls an agent expecting JSON back; retries ONCE if JSON parsing fails."""
    r = call_agent(agent_id, json.dumps(payload))
    try:
        return _extract_json(r.output_text), r
    except AgentOutputError as e:
        retry_payload = dict(payload)
        retry_payload["_previous_output_was_invalid_json"] = {
            "your_previous_output": e.raw_text[:2000],
            "parse_error": str(e.parse_error),
            "instruction": "Output ONLY the JSON object this time — no markdown fences, no prose before or after it.",
        }
        r2 = call_agent(agent_id, json.dumps(retry_payload))
        return _extract_json(r2.output_text), r2


def _log_agent_call(run, step: str, input_data, result, reasoning: str | None = None, **metadata):
    """Logs an agent call as a Langfuse span with one child span per tool call."""
    with run.span(step, **metadata):
        run.log(
            step=f"{step}_generation",
            input=input_data,
            output=result.output_text,
            usage=result.usage if result.usage else None,
            reasoning=reasoning,
            n_tool_calls=len(result.tool_calls),
        )
        for i, tc in enumerate(result.tool_calls):
            tool_metadata = {}
            tool_output = tc.get("output")
            if tool_output:
                try:
                    output_dict = json.loads(tool_output) if isinstance(tool_output, str) else tool_output
                    if isinstance(output_dict, dict) and "execution_time_ms" in output_dict:
                        tool_metadata["execution_time_ms"] = output_dict["execution_time_ms"]
                except (json.JSONDecodeError, TypeError):
                    pass
            run.log(
                step=f"{step}_tool[{i}]_{tc.get('name')}",
                input=tc.get("arguments"),
                output=tool_output,
                **tool_metadata,
            )
