"""Scripted responses for testing the evaluation tool. Test use only: these recognise nothing."""

from ptc_vision.board import ALL_SQUARES, parse_placement
from ptc_vision.contract import RecognitionFailure, RecognitionSuccess

START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"
# START with the e2 pawn missing
START_NO_E2 = "rnbqkbnr/pppppppp/8/8/8/8/PPPP1PPP/RNBQKBNR"


def success(
    placement=START,
    *,
    flagged=(),
    confidence=0.9,
    orientation_review=False,
    corners=None,
):
    board = parse_placement(placement)
    return RecognitionSuccess(
        source_kind="photo",
        board={
            "corners": corners
            or [{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}, {"x": 0, "y": 1}],
            "confidence": 0.9,
        },
        orientation={
            "quarter_turns_cw": 0,
            "confidence": 0.9,
            "method": "piece_layout",
            "needs_review": orientation_review,
        },
        placement=placement,
        squares=[
            {
                "square": s,
                "label": board[s],
                "confidence": confidence,
                "needs_review": s in flagged,
                "review_reasons": ["low_confidence"] if s in flagged else [],
            }
            for s in ALL_SQUARES
        ],
        engine={"name": "test-double", "version": "0"},
    )


def failure(code="no_board_detected"):
    return RecognitionFailure(code=code, message="m", retryable=True)


class ScriptedRecognizer:
    """Returns START for every image, except that an image reading b"crash" raises."""

    def recognize(self, image: bytes):
        if image == b"crash":
            raise RuntimeError("boom")
        return success()


def make_scripted_recognizer():
    return ScriptedRecognizer()
