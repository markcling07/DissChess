"""Writes the contract's JSON Schema. With --check, fails if the committed file is out of date."""

import argparse
import json
import sys
from pathlib import Path

from ptc_vision.contract import recognition_response_adapter

SCHEMA_PATH = (
    Path(__file__).resolve().parents[4]
    / "packages"
    / "contract"
    / "schema"
    / "recognition-response.schema.json"
)


def render_schema() -> str:
    schema = recognition_response_adapter.json_schema(mode="serialization")
    schema["title"] = "RecognitionResponse"
    return json.dumps(schema, indent=2, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    rendered = render_schema()
    if args.check:
        current = SCHEMA_PATH.read_text(encoding="utf-8") if SCHEMA_PATH.exists() else None
        if current != rendered:
            print("Contract schema is out of date. Run: pnpm contract:generate", file=sys.stderr)
            return 1
        return 0

    SCHEMA_PATH.parent.mkdir(parents=True, exist_ok=True)
    SCHEMA_PATH.write_text(rendered, encoding="utf-8", newline="\n")
    print(f"Wrote {SCHEMA_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
