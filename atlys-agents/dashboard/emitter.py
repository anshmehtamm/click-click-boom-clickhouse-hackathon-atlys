"""Best-effort event emitter used by tracing/langfuse_wrapper.py to feed the
realtime dashboard. Same optional-integration pattern as hyperdx_integration.py:
if the dashboard server isn't running, this fails silently and the pipeline is
unaffected — it is purely an observability side-channel, never load-bearing.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Any

import requests

_DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:8787")
_TIMEOUT_S = 0.5


def emit_event(event: dict[str, Any]) -> None:
    """Fire-and-forget POST, off the calling thread so a slow/dead dashboard
    server never adds latency to an agent call."""
    event = dict(event)
    event.setdefault("ts", time.time())
    threading.Thread(target=_post, args=(event,), daemon=True).start()


def _post(event: dict[str, Any]) -> None:
    try:
        requests.post(f"{_DASHBOARD_URL}/events", json=event, timeout=_TIMEOUT_S)
    except Exception:
        pass
