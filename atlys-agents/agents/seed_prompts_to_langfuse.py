"""Pushes the 4 agent prompts from agents/prompts.py into Langfuse's Prompt
Management as versioned, labeled prompts — Langfuse becomes the source of truth
`create_agents.py` reads from, instead of the Python constants.

Re-run this any time a prompt in prompts.py changes: create_prompt() always creates
a new version and moves the "production" label onto it (Langfuse versions are
immutable and append-only, same append-only pattern as agent_meta.context_versions).
The Python strings in prompts.py are NOT deleted — they stay in AGENTS as the
`fallback` create_agents.py passes to get_prompt(), so a Langfuse outage or an
unseeded prompt degrades to the last-known-good text baked into code rather than
crashing agent creation.

Usage: atlys-agents/.venv/bin/python -m agents.seed_prompts_to_langfuse
"""
from __future__ import annotations

from langfuse import get_client
from dotenv import load_dotenv

load_dotenv()

from agents.prompts import AGENTS  # noqa: E402


def main():
    client = get_client()
    for name, spec in AGENTS.items():
        prompt = client.create_prompt(
            name=name,
            prompt=spec["instructions"],
            labels=["production"],
            type="text",
            commit_message="seeded from agents/prompts.py",
        )
        print(f"{name}: pushed version {prompt.version} (label: production)")
    client.flush()


if __name__ == "__main__":
    main()
