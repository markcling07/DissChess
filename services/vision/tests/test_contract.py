import pytest
from ptc_vision.board import ALL_SQUARES, parse_placement
from ptc_vision.contract import (
    RecognitionFailure,
    RecognitionSuccess,
    SquareResult,
    recognition_response_adapter,
)
from pydantic import ValidationError

START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"


def payload(placement=START, **overrides):
    board = parse_placement(placement)
    corners = [{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}, {"x": 0, "y": 1}]
    return {
        "source_kind": "photo",
        "board": {"corners": corners, "confidence": 0.9},
        "orientation": {
            "quarter_turns_cw": 0,
            "confidence": 0.9,
            "method": "piece_layout",
            "needs_review": False,
        },
        "placement": placement,
        "squares": [
            {"square": s, "label": board[s], "confidence": 0.9, "needs_review": False}
            for s in ALL_SQUARES
        ],
        "engine": {"name": "test", "version": "0"},
        **overrides,
    }


def test_valid_response_round_trips_through_json():
    success = RecognitionSuccess(**payload())
    parsed = recognition_response_adapter.validate_json(success.model_dump_json())
    assert parsed == success
    assert parsed.contract_version == "1.0"


def test_status_selects_the_response_type():
    failure = recognition_response_adapter.validate_python(
        {"status": "error", "code": "no_board_detected", "message": "m", "retryable": True}
    )
    assert isinstance(failure, RecognitionFailure)


def test_a_full_fen_is_rejected():
    with pytest.raises(ValidationError):
        RecognitionSuccess(**payload() | {"placement": f"{START} w KQkq - 0 1"})


def test_there_is_no_field_for_details_a_photo_cannot_show():
    assert not {"side_to_move", "castling", "en_passant", "fen"} & set(
        RecognitionSuccess.model_fields
    )


def test_unknown_fields_are_rejected():
    with pytest.raises(ValidationError):
        RecognitionSuccess(**payload(side_to_move="w"))


def test_missing_square_is_rejected():
    data = payload()
    data["squares"] = data["squares"][:-1]
    with pytest.raises(ValidationError):
        RecognitionSuccess(**data)


def test_duplicate_square_is_rejected():
    data = payload()
    data["squares"][1] = {**data["squares"][0]}
    with pytest.raises(ValidationError):
        RecognitionSuccess(**data)


def test_placement_must_agree_with_squares():
    with pytest.raises(ValidationError, match="placement must match"):
        RecognitionSuccess(**payload() | {"placement": "8/8/8/8/8/8/8/8"})


@pytest.mark.parametrize(
    "bad",
    [
        {"needs_review": True},
        {"review_reasons": ["low_confidence"]},
        {"confidence": 1.5},
        {"alternatives": [{"label": "P", "probability": 0.05}]},
        {"alternatives": [{"label": "N", "probability": 0.5}]},
        {
            "alternatives": [
                {"label": "N", "probability": 0.01},
                {"label": "B", "probability": 0.02},
            ]
        },
    ],
)
def test_inconsistent_square_is_rejected(bad):
    base = {"square": "a2", "label": "P", "confidence": 0.9, "needs_review": False}
    with pytest.raises(ValidationError):
        SquareResult(**base | bad)


def test_failure_code_must_be_known():
    with pytest.raises(ValidationError):
        RecognitionFailure(code="something_else", message="m", retryable=False)


def test_schema_file_is_current():
    from ptc_vision.export_schema import SCHEMA_PATH, render_schema

    assert SCHEMA_PATH.read_text(encoding="utf-8") == render_schema()
