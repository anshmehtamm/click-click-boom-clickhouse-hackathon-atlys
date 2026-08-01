"""Thin compatibility shim over agent_runner.run_agent.

Was: a wrapper around LibreChat's Agents API (beta). Rewritten to call OpenAI's
Responses API directly instead -- confirmed via direct testing that LibreChat's
proxy never returns real function_call arguments, real tool output, or any
reasoning content (empty in non-streaming, streaming, and streaming with an
explicit reasoning.summary param), while calling OpenAI directly returns all
three correctly. See agent_runner/runner.py for the actual implementation; this
module just keeps the same public shape (`call_agent`, `AgentResult`,
`smoke_test`) so orchestrator/agent_io.py and every caller of it don't need to
change beyond `agent_id` now meaning an agents/prompts.py AGENTS dict key
(e.g. "instrumentation_proposer") instead of a LibreChat agent ID pulled from
.env -- there is no LibreChat agent ID anymore, nothing to look up.

`previous_response_id` is no longer a caller-facing concept: agent_runner.run_agent
handles its own internal turn-to-turn chaining (confirmed working, unlike
LibreChat's) as an implementation detail of finishing ONE agent invocation's tool
loop. It was never meant to persist across separate invocations anyway (every
rework round is a fresh conversation by design -- see agents/prompts.py's REWORK
ROUNDS section).
"""
from __future__ import annotations

from agent_runner import AgentResult, run_agent

__all__ = ["AgentResult", "call_agent", "smoke_test"]


def call_agent(agent_id: str, input_text: str, timeout: int = 180, on_event=None) -> AgentResult:
    """`agent_id` is an agents/prompts.py AGENTS dict key, e.g.
    "instrumentation_proposer" -- kept as the parameter name for compatibility
    with existing call sites, not because it's still a LibreChat identifier.
    `on_event(kind, name, input, output)` fires live during the tool-calling loop
    -- see agent_runner.runner.run_agent's docstring."""
    return run_agent(agent_id, input_text, timeout=timeout, on_event=on_event)


def smoke_test(agent_id: str) -> AgentResult:
    """Minimal round-trip check — call this first against any newly wired-up agent key."""
    return call_agent(agent_id, "Reply with exactly the word: pong")
