"""Shared Langfuse tracing wrapper with HyperDX integration. Every agent action logs
through this — nobody calls the Langfuse SDK directly.

Verified against langfuse==4.14.2's real API by introspection, not docs/memory — the
v4 SDK is OpenTelemetry-based and has NO `Langfuse.trace()` / `.span()` methods (that
was the v2/v3 API). The real primitives are:
  - `get_client()`            — singleton reading LANGFUSE_PUBLIC_KEY/SECRET_KEY/HOST from env
  - `client.start_as_current_observation(name=..., as_type="span", ...)` — a context
    manager; nesting is automatic OTel context propagation (create one inside another's
    `with` block and it becomes a child span, no manual parent-linking needed)
  - `propagate_attributes(tags=..., metadata=..., ...)` — module-level context manager
    that sets trace-level tags/metadata on the current + all subsequently-created spans
  - `client.get_trace_url(trace_id=...)` — the root span's `.trace_id` attribute gives you this

HyperDX Integration:
  - All logs and traces are also sent to HyperDX for centralized observability
  - Langfuse traces are cross-referenced in HyperDX via trace IDs

Usage:

    from tracing import traced_run

    with traced_run(agent="instrumentation", spec="express_checkout") as run:
        run.log(step="propose_ordering_key", input=spec_text, output=ddl, reasoning="...")

        with run.span("context_review", revision=1):
            ...  # nested sub-steps for a multi-part step, e.g. an agent turn with tool calls

        trace_url = run.url   # store this on the agent_meta row you just wrote
"""
import contextlib
import logging
from datetime import datetime, timezone

from dotenv import load_dotenv
from langfuse import get_client, propagate_attributes

load_dotenv()

# Import ClickStack integration (but don't initialize yet - we'll do it after first Langfuse call)
from .hyperdx_integration import init_hyperdx, get_tracer, log_to_hyperdx
from dashboard.emitter import emit_event

_clickstack_initialized = False


def _step_kind(step: str) -> str:
    """Classifies a step name for the dashboard's UI (icon/color per row), purely
    cosmetic — matches the naming convention orchestrator/agent_io.py's
    _call_json_agent already uses (`{step}_generation`, `{step}_tool[i]_{name}`,
    `{step}_reasoning[turnN]` — the last logged LIVE per turn during the
    tool-calling loop, not batched at the end)."""
    if "_tool[" in step:
        return "tool_call"
    if "_reasoning[" in step:
        return "reasoning"
    if step.endswith("_generation"):
        return "generation"
    return "log"


class Run:
    """Wraps one Langfuse trace for a full pipeline run (e.g. one spec's
    propose -> review -> [rework] -> test -> execute -> commit sequence)."""

    def __init__(self, client, root_span, agent: str = "", spec: str = ""):
        self._client = client
        self._root_span = root_span
        self.agent = agent
        self.spec = spec

    @property
    def trace_id(self) -> str:
        return self._root_span.trace_id

    @property
    def url(self) -> str:
        return self._client.get_trace_url(trace_id=self._root_span.trace_id)

    def log(self, step: str, input=None, output=None, reasoning: str = None, usage: dict = None, **metadata):
        """One-shot child span for a single call/decision with no sub-steps of its own."""
        meta = dict(metadata)
        if reasoning is not None:
            meta["reasoning"] = reasoning

        # Log to ClickStack
        log_to_hyperdx(
            "info",
            f"[{step}] {reasoning or step}",
            trace_id=self.trace_id,
            langfuse_url=self.url,
            **meta
        )

        # Log to realtime dashboard (best-effort, see dashboard/emitter.py)
        emit_event({
            "event": "log",
            "kind": _step_kind(step),
            "trace_id": self.trace_id,
            "trace_url": self.url,
            "agent": self.agent,
            "spec": self.spec,
            "step": step,
            "input": input,
            "output": output,
            "reasoning": reasoning,
            "usage": usage,
            "metadata": metadata,
        })

        # Use "generation" type if usage data is provided (LLM call), otherwise "span"
        observation_type = "generation" if usage else "span"
        kwargs = {
            "name": step,
            "as_type": observation_type,
            "input": input,
            "output": output,
            "metadata": meta or None,
        }
        if usage:
            # Langfuse v4 expects usage_details parameter (not "usage")
            # The format should match: {input: int, output: int, total: int}
            kwargs["usage_details"] = usage

        with self._client.start_as_current_observation(**kwargs):
            pass

    @contextlib.contextmanager
    def span(self, name: str, **metadata):
        """Nested span for a step that itself has multiple sub-actions (e.g. an
        agent turn that made several tool calls) — log those sub-steps onto the
        yielded span via further run.log(...) calls made while inside this `with`."""
        # Log span start to ClickStack
        log_to_hyperdx(
            "info",
            f"[span:start] {name}",
            trace_id=self.trace_id,
            langfuse_url=self.url,
            **metadata
        )
        emit_event({
            "event": "span_start", "kind": "span",
            "trace_id": self.trace_id, "trace_url": self.url,
            "agent": self.agent, "spec": self.spec,
            "step": name, "metadata": metadata,
        })

        with self._client.start_as_current_observation(
            name=name, as_type="span", metadata=metadata or None
        ) as span:
            try:
                yield span
            finally:
                # Log span end to ClickStack
                log_to_hyperdx(
                    "info",
                    f"[span:end] {name}",
                    trace_id=self.trace_id,
                    langfuse_url=self.url,
                    **metadata
                )
                emit_event({
                    "event": "span_end", "kind": "span",
                    "trace_id": self.trace_id, "trace_url": self.url,
                    "agent": self.agent, "spec": self.spec,
                    "step": name, "metadata": metadata,
                })


@contextlib.contextmanager
def traced_run(agent: str, spec: str, **extra_tags):
    """Opens one Langfuse trace. `agent` in {'instrumentation','analytics','context','pipeline'},
    `spec` is the feature-spec slug (e.g. 'express_checkout', 'unseen'). Extra kwargs become
    additional tags, e.g. traced_run(agent="instrumentation", spec="unseen", revision=2)."""
    global _clickstack_initialized

    client = get_client()

    # Initialize ClickStack after Langfuse's TracerProvider is set up
    if not _clickstack_initialized:
        init_hyperdx()
        _clickstack_initialized = True

    tags = [
        f"agent:{agent}",
        f"spec:{spec}",
        f"run:{datetime.now(timezone.utc):%Y-%m-%d}",
    ]
    tags += [f"{k}:{v}" for k, v in extra_tags.items()]

    with client.start_as_current_observation(name=f"{agent}:{spec}", as_type="span") as root_span:
        with propagate_attributes(tags=tags, metadata={"agent": agent, "spec": spec, **extra_tags}):
            run = Run(client, root_span, agent=agent, spec=spec)

            # Log trace start to ClickStack
            log_to_hyperdx(
                "info",
                f"[trace:start] {agent}:{spec}",
                trace_id=run.trace_id,
                langfuse_url=run.url,
                agent=agent,
                spec=spec,
                **extra_tags
            )
            emit_event({
                "event": "trace_start", "kind": "trace",
                "trace_id": run.trace_id, "trace_url": run.url,
                "agent": agent, "spec": spec, "metadata": extra_tags,
            })

            try:
                yield run
            finally:
                # Log trace end to ClickStack
                log_to_hyperdx(
                    "info",
                    f"[trace:end] {agent}:{spec}",
                    trace_id=run.trace_id,
                    langfuse_url=run.url,
                    agent=agent,
                    spec=spec,
                    **extra_tags
                )
                emit_event({
                    "event": "trace_end", "kind": "trace",
                    "trace_id": run.trace_id, "trace_url": run.url,
                    "agent": agent, "spec": spec, "metadata": extra_tags,
                })
                client.flush()
