import pytest
from ptc_eval.corpus import CorpusEntry
from ptc_eval.metrics import (
    aggregate,
    aggregate_refusals,
    bootstrap_square_error,
    breakdown,
    calibration_error,
    confusion_matrix,
    score_board,
    score_refusal,
)
from ptc_test_doubles import START, START_NO_E2, failure, success
from ptc_vision.board import parse_placement, rotate_board, to_placement


def entry(id="a", placement=START, **overrides):
    return CorpusEntry(
        id=id,
        image=f"{id}.png",
        kind="photo",
        set_id="set-1",
        split="dev",
        source="test",
        license="test",
        placement=placement,
        **overrides,
    )


def refusal_entry(expected="no_board_detected"):
    return CorpusEntry(
        id="r",
        image="r.png",
        kind="photo",
        set_id="set-1",
        split="dev",
        source="test",
        license="test",
        expected_failure=expected,
    )


def test_perfect_board():
    summary = aggregate([score_board(entry(), success())])
    assert summary["square_error_overall"] == 0
    assert summary["occupied_error_overall"] == 0
    assert summary["boards_zero_errors"] == 1
    assert summary["recognised_rate"] == 1
    assert summary["silently_wrong_boards"] == 0
    assert summary["flag_recall"] is None  # no wrong squares to flag, which is not the same as 0


def test_one_wrong_square_unflagged():
    scores = [
        score_board(entry("a"), success()),
        score_board(entry("b"), success(START_NO_E2)),
    ]
    summary = aggregate(scores)
    assert summary["square_error_overall"] == 1 / 128
    assert summary["occupied_error_overall"] == 1 / 64
    assert summary["boards_zero_errors"] == 0.5
    assert summary["boards_at_most_one_error"] == 1
    assert summary["mean_wrong_squares_recognised"] == 0.5
    assert summary["flag_recall"] == 0
    assert summary["silently_wrong_boards"] == 0.5


def test_wrong_square_that_is_flagged_is_not_silent():
    score = score_board(entry(), success(START_NO_E2, flagged=("e2", "a1", "a2", "a3")))
    summary = aggregate([score])
    assert summary["flag_recall"] == 1
    assert summary["flag_precision"] == 1 / 4
    assert summary["flag_rate"] == 4 / 64
    assert summary["silently_wrong_boards"] == 0


def test_flagged_orientation_covers_the_whole_board_and_counts_in_flag_rate():
    summary = aggregate([score_board(entry(), success(START_NO_E2, orientation_review=True))])
    assert summary["flag_recall"] == 1
    assert summary["flag_rate"] == 1
    assert summary["silently_wrong_boards"] == 0


def test_failure_counts_as_all_squares_wrong_overall_but_not_recognised():
    scores = [score_board(entry("a"), success()), score_board(entry("b"), failure())]
    summary = aggregate(scores)
    assert summary["recognised_rate"] == 0.5
    assert summary["square_error_overall"] == 0.5
    assert summary["occupied_error_overall"] == 0.5
    assert summary["square_error_recognised"] == 0
    assert summary["boards_zero_errors"] == 0.5
    assert summary["failures"] == {"no_board_detected": 1}
    assert summary["silently_wrong_boards"] == 0


def test_crash_is_reported_separately_from_a_refusal():
    summary = aggregate([score_board(entry(), None)])
    assert summary["failures"] == {"crash": 1}
    assert summary["square_error_overall"] == 1
    assert summary["square_error_recognised"] is None


@pytest.mark.parametrize("turns", [1, 2, 3])
def test_wrong_orientation_is_separated_from_wrong_pieces(turns):
    predicted = to_placement(rotate_board(parse_placement(START), turns))
    score = score_board(entry(), success(predicted))
    assert score.best_rotation == (4 - turns) % 4
    summary = aggregate([score])
    assert summary["square_error_recognised"] > 0
    assert summary["square_error_best_rotation"] == 0
    assert summary["orientation_correct"] == 0


def test_symmetric_position_keeps_rotation_zero():
    empty = "8/8/8/8/8/8/8/8"
    assert score_board(entry(placement=empty), success(empty)).best_rotation == 0


def test_corner_error_is_mean_distance():
    truth = [{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}, {"x": 0, "y": 1}]
    moved = [{"x": 0.1, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}, {"x": 0, "y": 1}]
    score = score_board(entry(corners=truth), success(corners=moved))
    assert score.corner_error == pytest.approx(0.1 / 4)


def test_calibration_error():
    assert calibration_error([(1.0, True)] * 10) == 0
    assert calibration_error([(0.95, False)] * 10) == pytest.approx(0.95)
    assert calibration_error([(0.5, True), (0.5, False)]) == 0
    assert calibration_error([]) is None


def test_confidence_of_one_lands_in_the_top_bin():
    assert calibration_error([(1.0, False)]) == 1


def test_bootstrap_interval_contains_the_estimate_and_is_repeatable():
    scores = [score_board(entry(str(i)), success()) for i in range(8)]
    scores += [score_board(entry(str(i + 8)), success(START_NO_E2)) for i in range(8)]
    low, high = bootstrap_square_error(scores)
    assert low <= aggregate(scores)["square_error_overall"] <= high
    assert low < high
    assert bootstrap_square_error(scores) == [low, high]


def test_bootstrap_needs_two_boards():
    assert bootstrap_square_error([score_board(entry(), success())]) is None


def test_confusion_matrix_counts_every_square():
    matrix = confusion_matrix([score_board(entry(), success(START_NO_E2))])
    assert matrix["P"] == {"P": 7, "empty": 1}
    assert sum(sum(row.values()) for row in matrix.values()) == 64


def test_breakdown_groups_by_set_and_tag():
    scores = [
        score_board(entry("a", tags=["angled"]), success()),
        score_board(entry("b", tags=["angled", "dim"]), success(START_NO_E2)),
    ]
    groups = breakdown(scores)
    assert groups["tag"]["angled"]["boards"] == 2
    assert groups["tag"]["dim"]["boards_zero_errors"] == 0
    assert groups["set_id"]["set-1"]["boards"] == 2


def test_refusals():
    scores = [
        score_refusal(refusal_entry(), failure()),
        score_refusal(refusal_entry(), success()),
        score_refusal(refusal_entry(), failure("image_too_blurry")),
        score_refusal(refusal_entry(), None),
    ]
    summary = aggregate_refusals(scores)
    assert summary["images"] == 4
    assert summary["correct"] == 1
    assert summary["false_accepts"] == 1
    assert summary["crashes"] == 1
    assert len(summary["mismatches"]) == 3


def test_empty_input_reports_no_value_rather_than_zero_error():
    summary = aggregate([])
    assert summary["square_error_overall"] is None
    assert summary["boards_zero_errors"] is None
