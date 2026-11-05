"""Runs the real engine and model on committed images, end to end."""

import json
from pathlib import Path

import numpy as np
import pytest
from ptc_vision.board import ALL_SQUARES, parse_placement
from ptc_vision.contract import RecognitionFailure, RecognitionSuccess
from ptc_vision.engine import make_recognizer, resolve_labels
from ptc_vision.tiles import LABELS

FIXTURES = Path(__file__).resolve().parents[3] / "apps" / "web" / "e2e" / "fixtures"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
BOARDS = [name for name, details in EXPECTED.items() if "placement" in details]
REFUSALS = [name for name, details in EXPECTED.items() if "failure" in details]


@pytest.fixture(scope="module")
def engine():
    return make_recognizer()


def read(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


@pytest.mark.parametrize("name", BOARDS)
def test_reads_the_position(engine, name):
    result = engine.recognize(read(name))
    assert isinstance(result, RecognitionSuccess), result
    assert result.placement == EXPECTED[name]["placement"]
    assert result.source_kind == "screenshot"


@pytest.mark.parametrize("name", BOARDS)
def test_reports_which_side_is_at_the_bottom_or_asks(engine, name):
    result = engine.recognize(read(name))
    expected = 2 if EXPECTED[name]["flipped"] else 0
    assert result.orientation.needs_review or result.orientation.quarter_turns_cw == expected


@pytest.mark.parametrize("name", REFUSALS)
def test_refuses_with_the_right_reason(engine, name):
    result = engine.recognize(read(name))
    assert isinstance(result, RecognitionFailure), result
    assert result.code == EXPECTED[name]["failure"]
    assert result.message
    assert result.retryable


def test_multiple_boards_are_all_reported(engine):
    result = engine.recognize(read("two-boards.png"))
    assert len(result.board_candidates) == 2


def test_never_includes_details_a_picture_cant_show(engine):
    data = engine.recognize(read("midgame.png")).model_dump()
    assert not {"fen", "side_to_move", "castling", "en_passant"} & set(data)
    assert " " not in data["placement"]


def test_every_square_is_reported_once_and_matches_the_placement(engine):
    result = engine.recognize(read("midgame.png"))
    assert sorted(s.square for s in result.squares) == sorted(ALL_SQUARES)
    board = parse_placement(result.placement)
    assert {s.square: s.label for s in result.squares} == board


def test_includes_a_preview_and_timings(engine):
    result = engine.recognize(read("midgame.png"))
    assert result.rectified_preview.startswith("data:image/jpeg;base64,")
    assert set(result.timings_ms) >= {"decode", "locate", "classify"}
    assert result.engine.name == "screenshot"
    assert result.engine.version


def test_a_bad_file_is_a_failure_and_not_a_crash(engine):
    assert engine.recognize(b"not an image").code == "unsupported_media_type"
    assert engine.recognize(b"").code == "unsupported_media_type"


def chances(squares: dict[int, dict[str, float]]) -> np.ndarray:
    """64 squares that are empty, except those given, which have these label probabilities."""
    table = np.zeros((64, len(LABELS)))
    table[:, LABELS.index("empty")] = 1.0
    for index, values in squares.items():
        table[index] = 0.0
        for label, value in values.items():
            table[index, LABELS.index(label)] = value
    return table


class TestOneKingPerSide:
    BLACK_KING = {60: {"k": 0.99}}
    WHITE_KING = {4: {"K": 0.99}}

    def test_clear_kings_are_left_alone(self):
        chosen, changed = resolve_labels(chances(self.BLACK_KING | self.WHITE_KING))
        assert chosen[4] == LABELS.index("K")
        assert chosen[60] == LABELS.index("k")
        assert changed == set()

    def test_a_missing_king_comes_from_the_most_king_like_piece(self):
        table = chances(self.BLACK_KING | {3: {"Q": 0.7, "K": 0.25}, 12: {"Q": 0.9, "K": 0.05}})
        chosen, changed = resolve_labels(table)
        assert chosen[3] == LABELS.index("K")
        assert chosen[12] == LABELS.index("Q")
        assert changed == {3}

    def test_only_the_same_colour_can_become_the_king(self):
        table = chances(self.BLACK_KING | {3: {"q": 0.7, "K": 0.25}})
        chosen, changed = resolve_labels(table)
        assert chosen[3] == LABELS.index("q")
        assert changed == set()

    def test_an_empty_square_doesnt_become_a_king(self):
        table = chances(self.BLACK_KING | {3: {"empty": 0.7, "K": 0.3}})
        chosen, changed = resolve_labels(table)
        assert chosen[3] == LABELS.index("empty")
        assert changed == set()

    def test_a_king_stays_missing_when_nothing_looks_like_one(self):
        table = chances(self.BLACK_KING | {3: {"Q": 0.999, "K": 0.001}})
        chosen, changed = resolve_labels(table)
        assert chosen[3] == LABELS.index("Q")
        assert changed == set()

    def test_a_second_king_becomes_its_next_most_likely_label(self):
        table = chances(self.BLACK_KING | {4: {"K": 0.9, "Q": 0.1}, 12: {"K": 0.6, "Q": 0.4}})
        chosen, changed = resolve_labels(table)
        assert chosen[4] == LABELS.index("K")
        assert chosen[12] == LABELS.index("Q")
        assert changed == {12}


class TestPawns:
    KINGS = {60: {"k": 0.99}, 4: {"K": 0.99}}

    @pytest.mark.parametrize("index", [0, 7, 56, 63])
    @pytest.mark.parametrize("pawn", ["P", "p"])
    def test_a_pawn_cant_stand_on_the_first_or_last_rank(self, index, pawn):
        other = "B" if pawn == "P" else "b"
        chosen, changed = resolve_labels(chances(self.KINGS | {index: {pawn: 0.8, other: 0.2}}))
        assert chosen[index] == LABELS.index(other)
        assert changed == {index}

    def test_a_pawn_elsewhere_is_left_alone(self):
        chosen, changed = resolve_labels(chances(self.KINGS | {8: {"P": 0.8, "B": 0.2}}))
        assert chosen[8] == LABELS.index("P")
        assert changed == set()

    def test_a_ninth_pawn_gives_way_starting_with_the_least_certain(self):
        squares = {i: {"P": 0.9, "B": 0.1} for i in range(8, 16)}
        squares[16] = {"P": 0.55, "B": 0.45}
        chosen, changed = resolve_labels(chances(self.KINGS | squares))
        assert chosen[16] == LABELS.index("B")
        assert changed == {16}
        assert (chosen == LABELS.index("P")).sum() == 8


def test_a_square_the_king_rule_changed_is_flagged_and_keeps_a_valid_reply(engine):
    table = chances({60: {"k": 0.99}, 3: {"Q": 0.7, "K": 0.25, "R": 0.05}})
    result = engine._square_result("d1", table[3], LABELS.index("K"), True)
    assert result.label == "K"
    assert result.confidence == pytest.approx(0.25)
    assert result.needs_review
    assert "position_conflict" in result.review_reasons
    assert [a.label for a in result.alternatives] == ["Q", "R"]
