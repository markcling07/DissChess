import io

import numpy as np
import pytest
from PIL import Image
from ptc_vision.board import parse_placement
from ptc_vision.contract import Point, RecognitionFailure, RecognitionSuccess
from ptc_vision.photo import (
    MODEL_PATH,
    Detection,
    DetectorInfo,
    PhotoRecognizer,
    PieceDetector,
    _grid_square,
    best_rotation,
    check_corners,
    order_clockwise,
    turns_for_white_edge,
)

START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"
LABELS = "PNBRQKpnbrqk"
# Box heights in pixels, for squares 100 pixels wide: pawns are clearly the short pieces.
HEIGHTS = {"P": 70, "N": 120, "B": 130, "R": 110, "Q": 150, "K": 160}
INFO = DetectorInfo(
    version="test",
    labels=LABELS,
    input_size=640,
    min_confidence=0.25,
    base_fraction=0.05,
    pawn_height_cut=0.65,
    review_threshold=0.6,
    empty_confidence=0.9,
)
WHOLE_IMAGE = [Point(x=0, y=0), Point(x=1, y=0), Point(x=1, y=1), Point(x=0, y=1)]


def png(size: int = 800) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (size, size), (120, 120, 120)).save(buffer, format="PNG")
    return buffer.getvalue()


def detection(row: int, column: int, label: str, confidence: float = 0.9, height=None) -> Detection:
    """A piece standing on a cell of an 800 pixel image filled by the board."""
    tall = height if height is not None else HEIGHTS[label.upper()]
    bottom = (row + 1) * 100 - 10
    scores = np.zeros(len(LABELS), dtype=np.float32)
    scores[LABELS.index(label)] = confidence
    return Detection(
        box=(column * 100 + 20, bottom - tall, column * 100 + 80, bottom), scores=scores
    )


class FakeDetector:
    info = INFO

    def __init__(self, detections: list[Detection]):
        self.detections = detections
        self.shapes = []

    def detect(self, rgb):
        self.shapes.append(rgb.shape)
        return self.detections


def layout(grid_rows: list[str]) -> list[Detection]:
    """Detections from eight strings of eight characters, as the pieces appear in the image."""
    return [
        detection(row, column, char)
        for row, text in enumerate(grid_rows)
        for column, char in enumerate(text)
        if char != "."
    ]


STARTING_ROWS = [
    "rnbqkbnr",
    "pppppppp",
    "........",
    "........",
    "........",
    "........",
    "PPPPPPPP",
    "RNBQKBNR",
]


def test_corners_are_put_in_clockwise_order_from_the_top_left():
    points = np.array([[1, 1], [0, 0], [0, 1], [1, 0]], dtype=np.float32)
    assert order_clockwise(points).tolist() == [[0, 0], [1, 0], [1, 1], [0, 1]]


def test_tapped_corners_must_make_a_board():
    assert check_corners(WHOLE_IMAGE) is None
    crossed_out = [
        Point(x=0.5, y=0.5),
        Point(x=0.1, y=0.1),
        Point(x=0.9, y=0.1),
        Point(x=0.5, y=0.2),
    ]
    assert "four-sided" in check_corners(crossed_out)
    tiny = [Point(x=0.5, y=0.5), Point(x=0.52, y=0.5), Point(x=0.52, y=0.52), Point(x=0.5, y=0.52)]
    assert "too close" in check_corners(tiny)


@pytest.mark.parametrize(
    ("turns", "corner"),
    [(0, "a8"), (1, "h8"), (2, "h1"), (3, "a1")],
)
def test_the_top_left_cell_names_the_right_square_after_turning(turns, corner):
    assert _grid_square(0, 0, turns) == corner


def test_white_at_the_left_is_turned_to_the_bottom():
    # Rotate the starting layout so White's pieces are in the left two columns.
    grid = np.rot90(np.array([list(row.replace(".", "-")) for row in STARTING_ROWS]), -1)
    turns, confidence, evidence = best_rotation(grid.tolist())
    assert turns == 3
    assert evidence and confidence > 0.97


def test_reads_the_starting_position():
    result = PhotoRecognizer(FakeDetector(layout(STARTING_ROWS))).recognize(png(), WHOLE_IMAGE)
    assert isinstance(result, RecognitionSuccess)
    assert result.source_kind == "photo"
    assert result.placement == START
    assert result.orientation.quarter_turns_cw == 0
    assert result.rectified_preview.startswith("data:image/jpeg;base64,")


def test_reads_a_board_photographed_from_the_side():
    sideways = ["".join(row) for row in np.rot90(np.array([list(r) for r in STARTING_ROWS]), -1)]
    result = PhotoRecognizer(FakeDetector(layout(sideways))).recognize(png(), WHOLE_IMAGE)
    assert result.placement == START
    assert result.orientation.quarter_turns_cw == 3


@pytest.mark.parametrize(
    ("white", "turns"),
    [((400, 0), 2), ((800, 400), 1), ((400, 800), 0), ((0, 400), 3), ((790, 300), 1)],
)
def test_the_edge_nearest_whites_point_is_turned_to_the_bottom(white, turns):
    points = np.array([[0, 0], [800, 0], [800, 800], [0, 800]], dtype=np.float32)
    assert turns_for_white_edge(points, np.array(white, dtype=np.float32)) == turns


def test_whites_side_from_the_user_replaces_the_guess():
    sideways = ["".join(row) for row in np.rot90(np.array([list(r) for r in STARTING_ROWS]), -1)]
    recognizer = PhotoRecognizer(FakeDetector(layout(sideways)))
    result = recognizer.recognize(png(), WHOLE_IMAGE, white=Point(x=0.02, y=0.6))
    assert result.placement == START
    assert result.orientation.quarter_turns_cw == 3
    assert result.orientation.method == "user"
    assert result.orientation.confidence == 1.0
    assert not result.orientation.needs_review


def test_whites_side_is_trusted_even_against_the_pieces():
    # A lone king each says little, and the user knows where White sits.
    rows = ["....k...", *["........"] * 6, "....K..."]
    result = PhotoRecognizer(FakeDetector(layout(rows))).recognize(
        png(), WHOLE_IMAGE, white=Point(x=0.5, y=0.0)
    )
    assert result.orientation.quarter_turns_cw == 2
    assert result.placement == "3K4/8/8/8/8/8/8/3k4"
    assert all(issue.code != "orientation_uncertain" for issue in result.issues)


def test_a_short_piece_is_called_a_pawn_and_flagged():
    detections = layout(STARTING_ROWS)
    # The e2 pawn, misread as a bishop, but no taller than the other pawns.
    detections = [d for d in detections if d.box[0] != 420 or d.box[3] != 690]
    detections.append(detection(6, 4, "B", height=HEIGHTS["P"]))
    result = PhotoRecognizer(FakeDetector(detections)).recognize(png(), WHOLE_IMAGE)
    e2 = next(s for s in result.squares if s.square == "e2")
    assert e2.label == "P"
    assert e2.needs_review


def test_a_tall_piece_leaning_into_the_next_rank_counts_where_it_stands():
    # A queen whose top reaches two squares up still stands on d1.
    detections = [detection(7, 3, "Q", height=230), detection(0, 4, "k"), detection(7, 4, "K")]
    result = PhotoRecognizer(FakeDetector(detections)).recognize(png(), WHOLE_IMAGE)
    board = parse_placement(result.placement)
    assert board["d1"] == "Q"
    assert board["d2"] == "empty" and board["d3"] == "empty"


def test_keeps_the_more_confident_of_two_pieces_on_one_square():
    detections = [detection(7, 4, "K", 0.5), detection(7, 4, "Q", 0.9), detection(0, 4, "k")]
    result = PhotoRecognizer(FakeDetector(detections)).recognize(png(), WHOLE_IMAGE)
    labels = {s.square: s.label for s in result.squares}
    assert "Q" in labels.values()


def test_the_board_is_cropped_with_room_above_for_tall_pieces():
    fake = FakeDetector([])
    corners = [
        Point(x=0.25, y=0.25),
        Point(x=0.75, y=0.25),
        Point(x=0.75, y=0.75),
        Point(x=0.25, y=0.75),
    ]
    PhotoRecognizer(fake).recognize(png(), corners)
    height, width = fake.shapes[0][:2]
    assert width == 480 and height > width


def test_problems_with_the_image_are_reported():
    result = PhotoRecognizer(FakeDetector([])).recognize(b"not an image", WHOLE_IMAGE)
    assert isinstance(result, RecognitionFailure)
    assert result.code == "unsupported_media_type"


@pytest.mark.skipif(not MODEL_PATH.exists(), reason="no photo detector installed")
def test_the_installed_detector_runs():
    detector = PieceDetector()
    assert detector.detect(np.full((480, 640, 3), 128, dtype=np.uint8)) == []
