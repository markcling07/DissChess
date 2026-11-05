"""The recognition engine for screenshots: intake, then board, squares, orientation and checks."""

import base64
import time
from collections.abc import Callable

import cv2
import numpy as np

from ptc_vision.board import ALL_SQUARES, FILES, Board, to_placement
from ptc_vision.classifier import SquareClassifier
from ptc_vision.contract import (
    BoardLocation,
    EngineInfo,
    FailureCode,
    LabelProbability,
    Orientation,
    Point,
    PositionIssue,
    RecognitionFailure,
    RecognitionSuccess,
    ReviewReason,
    SquareResult,
)
from ptc_vision.grid import BoardRect, find_boards
from ptc_vision.intake import IntakeError, decode_image
from ptc_vision.orientation import decide_orientation
from ptc_vision.position_checks import check_layout
from ptc_vision.tiles import LABELS, extract_tiles

ALTERNATIVES = 3
MIN_ALTERNATIVE = 0.005
CLOSE_ALTERNATIVE = 0.15
PREVIEW_SIZE = 480
ENGINE_NAME = "screenshot"
# Below this a square is no better a king than anything else, so a king stays reported as missing.
MIN_KING_CHANCE = 0.01
KING_INDEX = {"w": LABELS.index("K"), "b": LABELS.index("k")}
PAWN_INDEX = {"w": LABELS.index("P"), "b": LABELS.index("p")}
MAX_PAWNS = 8
COLOUR_INDEXES = {
    "w": [LABELS.index(label) for label in "PNBRQK"],
    "b": [LABELS.index(label) for label in "pnbrqk"],
}

MESSAGES: dict[FailureCode, str] = {
    "no_board_detected": (
        "No flat chessboard was found. Screenshots of digital boards work best, and photos of real "
        "boards aren't supported yet. Try a clearer image, or arrange the position by hand."
    ),
    "multiple_boards_detected": (
        "This image has more than one chessboard. Crop it to the one you want and try again."
    ),
    "board_incomplete": (
        "Part of the board is cut off. Use an image showing all 64 squares and try again."
    ),
    "image_too_blurry": (
        "The image is too blurry to read. Try a sharper one, or arrange the position by hand."
    ),
}


def _failure(code: FailureCode, boards: list[BoardLocation] | None = None) -> RecognitionFailure:
    return RecognitionFailure(
        code=code, message=MESSAGES[code], retryable=True, board_candidates=boards or []
    )


def _location(rect: BoardRect, width: int, height: int) -> BoardLocation:
    def point(x: float, y: float) -> Point:
        return Point(x=min(1.0, max(0.0, x / width)), y=min(1.0, max(0.0, y / height)))

    return BoardLocation(
        corners=[
            point(rect.x, rect.y),
            point(rect.x + rect.size_x, rect.y),
            point(rect.x + rect.size_x, rect.y + rect.size_y),
            point(rect.x, rect.y + rect.size_y),
        ],
        confidence=rect.score,
    )


def _next_best(probabilities: np.ndarray, excluded: int) -> int:
    others = probabilities.copy()
    others[excluded] = -1
    return int(others.argmax())


def resolve_labels(probabilities: np.ndarray) -> tuple[np.ndarray, set[int]]:
    """Picks a label per square, using what the rules of chess allow.

    Each side has exactly one king, no pawn stands on the first or last rank, and no side has more
    than 8 pawns. Unfamiliar designs can look like the wrong piece, and reading each square alone
    can break these rules. Returns the chosen labels and the squares this changed, which get flagged
    for review because the image alone didn't settle them.
    """
    chosen = probabilities.argmax(axis=1)
    changed: set[int] = set()

    # The top and bottom rows of the image are the first and last ranks, whichever way it faces.
    for pawn in PAWN_INDEX.values():
        for index in [*range(8), *range(56, 64)]:
            if chosen[index] == pawn:
                chosen[index] = _next_best(probabilities[index], pawn)
                changed.add(index)
        pawns = np.flatnonzero(chosen == pawn)
        if len(pawns) > MAX_PAWNS:
            ordered = pawns[np.argsort(probabilities[pawns, pawn])]
            for index in ordered[: len(pawns) - MAX_PAWNS]:
                chosen[index] = _next_best(probabilities[index], pawn)
                changed.add(int(index))

    for colour, king in KING_INDEX.items():
        kings = np.flatnonzero(chosen == king)
        if len(kings) == 0:
            # Only a piece of this colour can be its king, so empty squares can't gain a piece.
            candidates = np.flatnonzero(np.isin(chosen, COLOUR_INDEXES[colour]))
            if len(candidates):
                best = candidates[probabilities[candidates, king].argmax()]
                if probabilities[best, king] >= MIN_KING_CHANCE:
                    chosen[best] = king
                    changed.add(int(best))
        elif len(kings) > 1:
            keep = kings[probabilities[kings, king].argmax()]
            for index in kings:
                if index != keep:
                    chosen[index] = _next_best(probabilities[index], king)
                    changed.add(int(index))
    return chosen, changed


def _square_name(row: int, column: int, white_at_bottom: bool) -> str:
    """The square shown at an image position."""
    if white_at_bottom:
        return f"{FILES[column]}{8 - row}"
    return f"{FILES[7 - column]}{row + 1}"


def _preview(rgb: np.ndarray, rect: BoardRect, white_at_bottom: bool) -> str:
    """The located board as a small JPEG, turned to match the position shown beside it."""
    left, top = max(0, round(rect.x)), max(0, round(rect.y))
    right, bottom = round(rect.x + rect.size_x), round(rect.y + rect.size_y)
    board = cv2.resize(rgb[top:bottom, left:right], (PREVIEW_SIZE, PREVIEW_SIZE), cv2.INTER_AREA)
    if not white_at_bottom:
        board = cv2.rotate(board, cv2.ROTATE_180)
    encoded, jpeg = cv2.imencode(
        ".jpg", cv2.cvtColor(board, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 80]
    )
    if not encoded:
        raise RuntimeError("Could not encode the preview.")
    return "data:image/jpeg;base64," + base64.b64encode(jpeg.tobytes()).decode("ascii")


class ScreenshotRecognizer:
    def __init__(self, classifier: SquareClassifier | None = None):
        self._classifier = classifier or SquareClassifier()

    def recognize(self, image: bytes) -> RecognitionSuccess | RecognitionFailure:
        timings: dict[str, float] = {}
        clock = _Stopwatch(timings)

        try:
            rgb = decode_image(image)
        except IntakeError as error:
            return error.failure
        clock.lap("decode")

        grid = find_boards(rgb)
        clock.lap("locate")
        height, width = rgb.shape[:2]
        if grid.incomplete:
            return _failure("board_incomplete")
        if grid.blurry:
            return _failure("image_too_blurry")
        if not grid.boards:
            return _failure("no_board_detected")
        if len(grid.boards) > 1:
            locations = [_location(rect, width, height) for rect in grid.boards]
            return _failure("multiple_boards_detected", locations)
        rect = grid.boards[0]

        tiles = extract_tiles(rgb, rect.x, rect.y, rect.size_x, rect.size_y)
        probabilities = self._classifier.probabilities(tiles)
        clock.lap("classify")

        return self._build_result(rgb, rect, probabilities, timings, clock)

    def _build_result(
        self,
        rgb: np.ndarray,
        rect: BoardRect,
        probabilities: np.ndarray,
        timings: dict[str, float],
        clock: "_Stopwatch",
    ) -> RecognitionSuccess:
        height, width = rgb.shape[:2]
        best, changed = resolve_labels(probabilities)
        grid = [[LABELS[int(best[row * 8 + column])] for column in range(8)] for row in range(8)]
        orientation = decide_orientation(grid)
        white_at_bottom = orientation.white_at_bottom

        board: Board = {}
        chances: dict[str, np.ndarray] = {}
        chosen: dict[str, int] = {}
        conflicts: set[str] = set()
        for row in range(8):
            for column in range(8):
                index = row * 8 + column
                square = _square_name(row, column, white_at_bottom)
                board[square] = grid[row][column]
                chances[square] = probabilities[index]
                chosen[square] = int(best[index])
                if index in changed:
                    conflicts.add(square)

        issues = check_layout(board)
        conflicts |= {square for issue in issues for square in issue.squares}
        if orientation.needs_review:
            issues.append(
                PositionIssue(
                    code="orientation_uncertain",
                    severity="warning",
                    message="Check which side is at the bottom of the board.",
                )
            )

        squares = [
            self._square_result(square, chances[square], chosen[square], square in conflicts)
            for square in ALL_SQUARES
        ]
        preview = _preview(rgb, rect, white_at_bottom)
        clock.lap("assemble")

        return RecognitionSuccess(
            source_kind="screenshot",
            board=_location(rect, width, height),
            orientation=Orientation(
                quarter_turns_cw=0 if white_at_bottom else 2,
                confidence=orientation.confidence,
                method="piece_layout" if orientation.has_evidence else "assumed",
                needs_review=orientation.needs_review,
            ),
            placement=to_placement(board),
            squares=squares,
            issues=issues,
            rectified_preview=preview,
            engine=EngineInfo(name=ENGINE_NAME, version=self._classifier.info.version),
            timings_ms=timings,
        )

    def _square_result(
        self, square: str, chances: np.ndarray, chosen: int, conflict: bool
    ) -> SquareResult:
        order = [int(i) for i in np.argsort(chances)[::-1] if int(i) != chosen]
        confidence = float(chances[chosen])
        alternatives = [
            LabelProbability(label=LABELS[i], probability=float(chances[i]))
            for i in order[:ALTERNATIVES]
            if chances[i] >= MIN_ALTERNATIVE
        ]
        reasons: list[ReviewReason] = []
        if confidence < self._classifier.info.review_threshold:
            reasons.append("low_confidence")
        if alternatives and alternatives[0].probability >= CLOSE_ALTERNATIVE:
            reasons.append("close_alternative")
        if conflict:
            reasons.append("position_conflict")
        return SquareResult(
            square=square,
            label=LABELS[chosen],
            # Rounding in floats can push the total a hair over 1, which the contract rejects.
            confidence=min(confidence, 1.0 - sum(a.probability for a in alternatives)),
            alternatives=alternatives,
            needs_review=bool(reasons),
            review_reasons=reasons,
        )


class _Stopwatch:
    def __init__(self, timings: dict[str, float], clock: Callable[[], float] = time.perf_counter):
        self._timings = timings
        self._clock = clock
        self._last = clock()

    def lap(self, name: str) -> None:
        now = self._clock()
        self._timings[name] = round((now - self._last) * 1000, 2)
        self._last = now


def make_recognizer() -> ScreenshotRecognizer:
    return ScreenshotRecognizer()
