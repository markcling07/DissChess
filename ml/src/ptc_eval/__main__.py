"""Command line for the evaluation tool.

Exit codes: 0 success, 1 a gate failed, 2 the run could not produce a valid result.
"""

import argparse
import importlib
import json
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from ptc_vision.contract import RecognitionFailure, RecognitionSuccess, recognition_response_adapter
from pydantic import ValidationError

from ptc_eval.corpus import CorpusEntry, CorpusError, load_corpus
from ptc_eval.metrics import (
    aggregate,
    aggregate_refusals,
    board_details,
    breakdown,
    confusion_matrix,
    score_board,
    score_refusal,
)

type Response = RecognitionSuccess | RecognitionFailure
GATE_PATTERN = re.compile(r"^(\w+)(<=|>=)([0-9.]+)$")
SMALL_SAMPLE = 30

SUMMARY_ROWS = [
    ("Boards", "boards", "count"),
    ("Recognised", "recognised_rate", "percent"),
    ("Square error, overall", "square_error_overall", "percent"),
    ("Occupied square error, overall", "occupied_error_overall", "percent"),
    ("Boards with no errors", "boards_zero_errors", "percent"),
    ("Boards with at most one error", "boards_at_most_one_error", "percent"),
    ("Square error, recognised only", "square_error_recognised", "percent"),
    ("Square error, best rotation", "square_error_best_rotation", "percent"),
    ("Orientation correct", "orientation_correct", "percent"),
    ("Mean wrong squares per board", "mean_wrong_squares_recognised", "number"),
    ("Wrong squares flagged (recall)", "flag_recall", "percent"),
    ("Squares flagged (rate)", "flag_rate", "percent"),
    ("Boards silently wrong", "silently_wrong_boards", "percent"),
    ("Calibration error, occupied", "calibration_error_occupied", "percent"),
    ("Mean corner error", "mean_corner_error", "number"),
    ("Latency p50 (ms)", "latency_ms_p50", "number"),
    ("Latency p95 (ms)", "latency_ms_p95", "number"),
]


class RunError(Exception):
    """The run cannot produce a valid result."""


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        if args.command == "validate":
            return _validate(args)
        return _run(args)
    except CorpusError as error:
        print(f"Corpus problems ({len(error.problems)}):", file=sys.stderr)
        for problem in error.problems:
            print(f"  {problem}", file=sys.stderr)
    except RunError as error:
        print(f"Error: {error}", file=sys.stderr)
    return 2


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="ptc_eval", description="Measure recognition accuracy.")
    commands = parser.add_subparsers(dest="command", required=True)

    validate = commands.add_parser("validate", help="check a corpus manifest and its images")
    validate.add_argument("corpus", type=Path)

    run = commands.add_parser("run", help="score an engine against a corpus")
    run.add_argument("corpus", type=Path)
    source = run.add_mutually_exclusive_group(required=True)
    source.add_argument(
        "--recognizer", help="module:factory, where factory() returns a Recognizer to run"
    )
    source.add_argument(
        "--predictions",
        type=Path,
        help='saved results, one JSON object per line: {"id": ..., "response": ...}',
    )
    run.add_argument("--split", choices=["dev", "holdout"], help="only use this split")
    run.add_argument("--kind", choices=["screenshot", "photo"], help="only use this image kind")
    run.add_argument(
        "--gate",
        action="append",
        default=[],
        metavar="METRIC<=VALUE",
        help="fail unless a metric meets this limit, e.g. square_error_overall<=0.001. Repeatable.",
    )
    run.add_argument("--output", type=Path, help="report path, by default under reports/")
    return parser.parse_args(argv)


def _validate(args: argparse.Namespace) -> int:
    entries = load_corpus(args.corpus)
    labelled = sum(e.placement is not None for e in entries)
    print(f"OK: {len(entries)} images ({labelled} labelled, {len(entries) - labelled} refusals).")
    return 0


def _run(args: argparse.Namespace) -> int:
    gates = [_parse_gate(text) for text in args.gate]
    entries = _filtered(load_corpus(args.corpus), args.split, args.kind)
    if not entries:
        raise RunError("no images to score, so no accuracy can be reported")

    if args.recognizer:
        results = _run_recognizer(args.recognizer, args.corpus, entries)
        engine = args.recognizer
    else:
        results = _read_predictions(args.predictions, entries)
        engine = str(args.predictions)

    boards = []
    refusals = []
    for entry, (response, latency) in zip(entries, results, strict=True):
        if entry.placement is not None:
            boards.append(score_board(entry, response, latency))
        else:
            refusals.append(score_refusal(entry, response))

    report = {
        "created": datetime.now(UTC).isoformat(timespec="seconds"),
        "engine": engine,
        "corpus": str(args.corpus),
        "filters": {"split": args.split, "kind": args.kind},
        "summary": aggregate(boards),
        "refusals": aggregate_refusals(refusals),
        "breakdown": breakdown(boards),
        "confusion": confusion_matrix(boards),
        "images": board_details(boards),
    }

    output = args.output or _default_report_path(args.corpus)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    _print_report(report)
    print(f"\nFull report: {output}")
    return 1 if _gates_failed(gates, report["summary"]) else 0


def _filtered(entries: list[CorpusEntry], split: str | None, kind: str | None) -> list[CorpusEntry]:
    return [
        e
        for e in entries
        if (split is None or e.split == split) and (kind is None or e.kind == kind)
    ]


def _run_recognizer(
    target: str, corpus_dir: Path, entries: list[CorpusEntry]
) -> list[tuple[Response | None, float]]:
    recognizer = _load_recognizer(target)
    results = []
    for entry in entries:
        image = (corpus_dir / entry.image).read_bytes()
        started = time.perf_counter()
        try:
            response = recognizer.recognize(image)
            if not isinstance(response, RecognitionSuccess | RecognitionFailure):
                raise TypeError(f"returned {type(response).__name__}")
        except Exception as error:  # one bad image must not abort the whole run
            print(f"Engine crashed on {entry.id}: {error!r}", file=sys.stderr)
            response = None
        results.append((response, (time.perf_counter() - started) * 1000))
    return results


def _load_recognizer(target: str):
    module_name, separator, factory_name = target.partition(":")
    if not separator or not module_name or not factory_name:
        raise RunError(f"--recognizer must look like module:factory, got {target!r}")
    try:
        factory = getattr(importlib.import_module(module_name), factory_name)
    except (ImportError, AttributeError) as error:
        raise RunError(f"cannot load recognizer {target!r}: {error}") from error
    return factory()


def _read_predictions(
    path: Path, entries: list[CorpusEntry]
) -> list[tuple[Response | None, float | None]]:
    if not path.is_file():
        raise RunError(f"predictions file not found: {path}")
    by_id: dict[str, Response] = {}
    for number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
            by_id[record["id"]] = recognition_response_adapter.validate_python(record["response"])
        except (json.JSONDecodeError, KeyError, TypeError, ValidationError) as error:
            raise RunError(f"{path} line {number}: {error}") from error

    # A missing result must not quietly shrink the test set.
    missing = [e.id for e in entries if e.id not in by_id]
    if missing:
        raise RunError(f"no prediction for {len(missing)} images, including {missing[:5]}")
    return [(by_id[e.id], None) for e in entries]


def _parse_gate(text: str) -> tuple[str, str, float]:
    match = GATE_PATTERN.match(text)
    if not match:
        raise RunError(f"gate must look like metric<=0.01 or metric>=0.95, got {text!r}")
    return match[1], match[2], float(match[3])


def _gates_failed(gates: list[tuple[str, str, float]], summary: dict) -> bool:
    failed = False
    for metric, operator, limit in gates:
        if metric not in summary:
            raise RunError(f"unknown gate metric {metric!r}")
        value = summary[metric]
        passed = value is not None and (value <= limit if operator == "<=" else value >= limit)
        print(f"Gate {metric} {operator} {limit}: {'pass' if passed else 'FAIL'} (value: {value})")
        failed = failed or not passed
    return failed


def _default_report_path(corpus_dir: Path) -> Path:
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    return Path("reports") / f"{stamp}-{corpus_dir.resolve().name}.json"


def _format(value, style: str) -> str:
    if value is None:
        return "n/a"
    if style == "count":
        return str(value)
    if style == "percent":
        return f"{value * 100:.2f}%"
    return f"{value:.3f}" if value < 10 else f"{value:.0f}"


def _print_report(report: dict) -> None:
    summary = report["summary"]
    print(f"Engine: {report['engine']}\nCorpus: {report['corpus']}\n")
    for label, key, style in SUMMARY_ROWS:
        print(f"{label:<34}{_format(summary[key], style):>10}")

    interval = summary["square_error_overall_ci95"]
    if interval:
        low, high = _format(interval[0], "percent"), _format(interval[1], "percent")
        print(f"\nSquare error 95% interval: {low} to {high}")
    if summary["failures"]:
        print(f"Failures: {summary['failures']}")
    if summary["boards"] < SMALL_SAMPLE:
        print(f"Warning: only {summary['boards']} boards, so these figures are not reliable yet.")

    refusals = report["refusals"]
    if refusals["images"]:
        print(
            f"\nRefusal images: {refusals['correct']}/{refusals['images']} correct, "
            f"{refusals['false_accepts']} wrongly accepted, {refusals['crashes']} crashes"
        )


if __name__ == "__main__":
    sys.exit(main())
