"""Scores recognition results.

Conventions that keep the numbers honest:

- A failed recognition counts as all 64 squares wrong in the *_overall metrics, so an engine can't
  look better by refusing hard images. Metrics named *_recognised cover only images it accepted.
- Most squares are empty, so plain square error flatters any engine. occupied_error_overall covers
  only squares that really hold a piece.
- A wrong square counts as flagged if the square or the board orientation is marked for review.
  flag_rate is reported next to flag_recall because flagging everything would make recall perfect.
"""

import math
import random
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from ptc_vision.board import ALL_SQUARES, EMPTY, Board, parse_placement, rotate_board
from ptc_vision.contract import RecognitionFailure, RecognitionSuccess

from ptc_eval.corpus import CorpusEntry

CRASH = "crash"
BOOTSTRAP_SAMPLES = 1000
BOOTSTRAP_SEED = 20261105
CALIBRATION_BINS = 10


@dataclass(frozen=True)
class BoardScore:
    id: str
    kind: str
    set_id: str
    tags: tuple[str, ...]
    truth: Board
    failure_code: str | None
    predicted: Board | None
    confidence: dict[str, float]
    flagged: frozenset[str]
    best_rotation: int | None
    wrong_at_best_rotation: int | None
    corner_error: float | None
    latency_ms: float | None

    @property
    def recognised(self) -> bool:
        return self.predicted is not None

    @property
    def wrong_squares(self) -> tuple[str, ...]:
        if self.predicted is None:
            return ALL_SQUARES
        return tuple(s for s in ALL_SQUARES if self.predicted[s] != self.truth[s])

    @property
    def unflagged_wrong_squares(self) -> tuple[str, ...]:
        if self.predicted is None:
            return ()
        return tuple(s for s in self.wrong_squares if s not in self.flagged)


@dataclass(frozen=True)
class RefusalScore:
    """An image that should be refused, such as one with no board in it."""

    id: str
    expected: str
    actual: str

    @property
    def correct(self) -> bool:
        return self.actual == self.expected

    @property
    def false_accept(self) -> bool:
        return self.actual == "ok"


def score_board(
    entry: CorpusEntry,
    response: RecognitionSuccess | RecognitionFailure | None,
    latency_ms: float | None = None,
) -> BoardScore:
    """Score one labelled image. A response of None means the engine crashed."""
    assert entry.placement is not None
    truth = parse_placement(entry.placement)
    common = {
        "id": entry.id,
        "kind": entry.kind,
        "set_id": entry.set_id,
        "tags": tuple(entry.tags),
        "truth": truth,
        "latency_ms": latency_ms,
    }

    if not isinstance(response, RecognitionSuccess):
        return BoardScore(
            **common,
            failure_code=response.code if response else CRASH,
            predicted=None,
            confidence={},
            flagged=frozenset(),
            best_rotation=None,
            wrong_at_best_rotation=None,
            corner_error=None,
        )

    predicted = {s.square: s.label for s in response.squares}
    flagged = (
        frozenset(ALL_SQUARES)
        if response.orientation.needs_review
        else frozenset(s.square for s in response.squares if s.needs_review)
    )
    best_rotation, wrong_at_best = _best_rotation(predicted, truth)
    return BoardScore(
        **common,
        failure_code=None,
        predicted=predicted,
        confidence={s.square: s.confidence for s in response.squares},
        flagged=flagged,
        best_rotation=best_rotation,
        wrong_at_best_rotation=wrong_at_best,
        corner_error=_corner_error(entry, response),
    )


def score_refusal(
    entry: CorpusEntry, response: RecognitionSuccess | RecognitionFailure | None
) -> RefusalScore:
    assert entry.expected_failure is not None
    if response is None:
        actual = CRASH
    elif isinstance(response, RecognitionSuccess):
        actual = "ok"
    else:
        actual = response.code
    return RefusalScore(id=entry.id, expected=entry.expected_failure, actual=actual)


def _best_rotation(predicted: Board, truth: Board) -> tuple[int, int]:
    """The rotation of the prediction that best matches the truth. Ties prefer no rotation."""
    best_turns, best_wrong = 0, 65
    for turns in range(4):
        rotated = rotate_board(predicted, turns)
        wrong = sum(rotated[s] != truth[s] for s in ALL_SQUARES)
        if wrong < best_wrong:
            best_turns, best_wrong = turns, wrong
    return best_turns, best_wrong


def _corner_error(entry: CorpusEntry, response: RecognitionSuccess) -> float | None:
    if entry.corners is None:
        return None
    distances = [
        math.hypot(a.x - b.x, a.y - b.y)
        for a, b in zip(entry.corners, response.board.corners, strict=True)
    ]
    return sum(distances) / len(distances)


def _ratio(numerator: float, denominator: float) -> float | None:
    return numerator / denominator if denominator else None


def _mean(values: Sequence[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _percentile(values: Sequence[float], fraction: float) -> float | None:
    """Nearest-rank percentile."""
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(fraction * len(ordered)) - 1)]


def calibration_error(pairs: Iterable[tuple[float, bool]]) -> float | None:
    """Expected calibration error: the average gap between stated confidence and actual accuracy."""
    bins: list[list[tuple[float, bool]]] = [[] for _ in range(CALIBRATION_BINS)]
    total = 0
    for confidence, correct in pairs:
        bins[min(int(confidence * CALIBRATION_BINS), CALIBRATION_BINS - 1)].append(
            (confidence, correct)
        )
        total += 1
    if not total:
        return None
    gap = 0.0
    for members in bins:
        if members:
            mean_confidence = sum(c for c, _ in members) / len(members)
            accuracy = sum(ok for _, ok in members) / len(members)
            gap += len(members) / total * abs(mean_confidence - accuracy)
    return gap


def bootstrap_square_error(scores: Sequence[BoardScore]) -> list[float] | None:
    """A 95% interval for square_error_overall, resampling whole boards.

    Errors on one board are related, so treating squares as independent would understate the
    uncertainty. Returns None with fewer than two boards.
    """
    if len(scores) < 2:
        return None
    wrong_counts = [len(s.wrong_squares) for s in scores]
    rng = random.Random(BOOTSTRAP_SEED)
    samples = sorted(
        sum(rng.choices(wrong_counts, k=len(wrong_counts))) / (64 * len(wrong_counts))
        for _ in range(BOOTSTRAP_SAMPLES)
    )
    return [samples[int(0.025 * BOOTSTRAP_SAMPLES)], samples[int(0.975 * BOOTSTRAP_SAMPLES) - 1]]


def aggregate(scores: Sequence[BoardScore]) -> dict:
    recognised = [s for s in scores if s.recognised]
    total_wrong = sum(len(s.wrong_squares) for s in scores)
    wrong_recognised = sum(len(s.wrong_squares) for s in recognised)
    wrong_counts = [len(s.wrong_squares) for s in scores]

    occupied_total = 0
    occupied_wrong = 0
    for score in scores:
        for square, label in score.truth.items():
            if label != EMPTY:
                occupied_total += 1
                occupied_wrong += score.predicted is None or score.predicted[square] != label

    all_pairs = []
    occupied_pairs = []
    for score in recognised:
        for square in ALL_SQUARES:
            pair = (score.confidence[square], score.predicted[square] == score.truth[square])
            all_pairs.append(pair)
            if score.predicted[square] != EMPTY or score.truth[square] != EMPTY:
                occupied_pairs.append(pair)

    flagged_total = sum(len(s.flagged) for s in recognised)
    flagged_wrong = sum(len(set(s.wrong_squares) & s.flagged) for s in recognised)
    best_rotation_wrong = sum(s.wrong_at_best_rotation for s in recognised)
    corner_errors = [s.corner_error for s in recognised if s.corner_error is not None]
    latencies = [s.latency_ms for s in scores if s.latency_ms is not None]

    failures: dict[str, int] = {}
    for score in scores:
        if score.failure_code:
            failures[score.failure_code] = failures.get(score.failure_code, 0) + 1

    return {
        "boards": len(scores),
        "recognised": len(recognised),
        "recognised_rate": _ratio(len(recognised), len(scores)),
        "failures": dict(sorted(failures.items())),
        "square_error_overall": _ratio(total_wrong, 64 * len(scores)),
        "square_error_overall_ci95": bootstrap_square_error(scores),
        "occupied_error_overall": _ratio(occupied_wrong, occupied_total),
        "boards_zero_errors": _ratio(sum(c == 0 for c in wrong_counts), len(scores)),
        "boards_at_most_one_error": _ratio(sum(c <= 1 for c in wrong_counts), len(scores)),
        "square_error_recognised": _ratio(wrong_recognised, 64 * len(recognised)),
        "square_error_best_rotation": _ratio(best_rotation_wrong, 64 * len(recognised)),
        "orientation_correct": _ratio(
            sum(s.best_rotation == 0 for s in recognised), len(recognised)
        ),
        "mean_wrong_squares_recognised": _ratio(wrong_recognised, len(recognised)),
        "flag_recall": _ratio(flagged_wrong, wrong_recognised),
        "flag_precision": _ratio(flagged_wrong, flagged_total),
        "flag_rate": _ratio(flagged_total, 64 * len(recognised)),
        "silently_wrong_boards": _ratio(
            sum(bool(s.unflagged_wrong_squares) for s in recognised), len(recognised)
        ),
        "calibration_error_all": calibration_error(all_pairs),
        "calibration_error_occupied": calibration_error(occupied_pairs),
        "mean_corner_error": _mean(corner_errors),
        "latency_ms_p50": _percentile(latencies, 0.50),
        "latency_ms_p95": _percentile(latencies, 0.95),
    }


def aggregate_refusals(scores: Sequence[RefusalScore]) -> dict:
    return {
        "images": len(scores),
        "correct": sum(s.correct for s in scores),
        "false_accepts": sum(s.false_accept for s in scores),
        "crashes": sum(s.actual == CRASH for s in scores),
        "mismatches": [
            {"id": s.id, "expected": s.expected, "actual": s.actual}
            for s in scores
            if not s.correct
        ],
    }


def confusion_matrix(scores: Iterable[BoardScore]) -> dict[str, dict[str, int]]:
    """Counts by true label, then predicted label, for recognised boards."""
    matrix: dict[str, dict[str, int]] = {}
    for score in scores:
        if score.predicted is None:
            continue
        for square, truth in score.truth.items():
            row = matrix.setdefault(truth, {})
            predicted = score.predicted[square]
            row[predicted] = row.get(predicted, 0) + 1
    return matrix


def breakdown(scores: Sequence[BoardScore]) -> dict[str, dict[str, dict]]:
    """The same metrics split by image kind, chess set or theme, and tag."""
    groups: dict[str, dict[str, list[BoardScore]]] = {"kind": {}, "set_id": {}, "tag": {}}
    for score in scores:
        groups["kind"].setdefault(score.kind, []).append(score)
        groups["set_id"].setdefault(score.set_id, []).append(score)
        for tag in score.tags:
            groups["tag"].setdefault(tag, []).append(score)
    return {
        group: {name: aggregate(members) for name, members in sorted(values.items())}
        for group, values in groups.items()
    }


def board_details(scores: Iterable[BoardScore]) -> list[dict]:
    """Per image results, for finding out why a number moved."""
    return [
        {
            "id": s.id,
            "failure_code": s.failure_code,
            "wrong_squares": [] if s.predicted is None else list(s.wrong_squares),
            "unflagged_wrong_squares": list(s.unflagged_wrong_squares),
            "best_rotation": s.best_rotation,
            "corner_error": s.corner_error,
            "latency_ms": s.latency_ms,
        }
        for s in scores
    ]
