"""First real end-to-end pipeline run: Express Checkout spec + a stratified sample
of its real NDJSON events (real from click-a-thon-2026-main, not synthetic)."""
import json
import pathlib
import sys
from collections import defaultdict

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from orchestrator import ingest_spec

SPEC_DIR = pathlib.Path(
    "/Users/anshmehta/Downloads/Clickhouse Hackathon/click-a-thon-2026-main/Atlys/specs/01_express_checkout"
)
PER_EVENT_SAMPLE = 30


def load_sample_events() -> list[dict]:
    by_event = defaultdict(list)
    with open(SPEC_DIR / "events.ndjson") as f:
        for line in f:
            e = json.loads(line)
            name = e.get("event")
            if len(by_event[name]) < PER_EVENT_SAMPLE:
                by_event[name].append(e)
    events = [e for group in by_event.values() for e in group]
    print(f"loaded {len(events)} sample events across {len(by_event)} event types: "
          f"{ {k: len(v) for k, v in by_event.items()} }")
    return events


def main():
    spec_markdown = (SPEC_DIR / "spec.md").read_text()
    sample_events = load_sample_events()

    result = ingest_spec(
        spec_name="express_checkout",
        spec_markdown=spec_markdown,
        sample_events=sample_events,
    )
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
