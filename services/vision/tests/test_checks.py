import numpy as np
from ptc_vision.board import parse_placement
from ptc_vision.orientation import decide_orientation
from ptc_vision.position_checks import check_layout
from ptc_vision.tiles import LABELS, TILE_SIZE, extract_tiles, to_model_input

START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"


def image_grid(placement: str, white_at_bottom: bool = True) -> list[list[str]]:
    board = parse_placement(placement)
    grid = [[board[f"{'abcdefgh'[column]}{8 - row}"] for column in range(8)] for row in range(8)]
    return grid if white_at_bottom else [list(reversed(row)) for row in reversed(grid)]


def codes(placement: str) -> list[str]:
    return [issue.code for issue in check_layout(parse_placement(placement))]


class TestOrientation:
    def test_starting_position_is_certain_either_way(self):
        upright = decide_orientation(image_grid(START))
        assert upright.white_at_bottom
        assert not upright.needs_review
        flipped = decide_orientation(image_grid(START, white_at_bottom=False))
        assert not flipped.white_at_bottom
        assert not flipped.needs_review

    def test_a_typical_middlegame_is_clear_either_way(self):
        fen = "r1bq1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1"
        assert decide_orientation(image_grid(fen)).white_at_bottom
        assert not decide_orientation(image_grid(fen, False)).white_at_bottom

    def test_an_empty_board_has_no_evidence_and_is_flagged(self):
        result = decide_orientation(image_grid("8/8/8/8/8/8/8/8"))
        assert not result.has_evidence
        assert result.needs_review
        assert result.confidence == 0.5

    def test_kings_side_by_side_are_flagged(self):
        result = decide_orientation(image_grid("8/8/8/2k1K3/8/8/8/8"))
        assert result.needs_review

    def test_opposing_evidence_lowers_confidence(self):
        clear = decide_orientation(image_grid(START)).confidence
        muddled = decide_orientation(image_grid("8/4P3/8/4k3/4K3/8/4p3/8")).confidence
        assert muddled < clear


class TestLayoutChecks:
    def test_standard_position_has_none(self):
        assert codes(START) == []

    def test_missing_kings(self):
        assert codes("8/8/8/8/8/8/8/8") == ["missing_king", "missing_king"]

    def test_extra_king_names_its_squares(self):
        issues = check_layout(parse_placement("4k3/8/8/8/8/8/8/K3K3"))
        assert [i.code for i in issues] == ["extra_king"]
        assert sorted(issues[0].squares) == ["a1", "e1"]

    def test_pawn_on_back_rank(self):
        assert "pawn_on_back_rank" in codes("P3k3/8/8/8/8/8/8/4K3")
        assert "pawn_on_back_rank" in codes("4k3/8/8/8/8/8/8/p3K3")

    def test_too_many_pawns(self):
        assert "too_many_pawns" in codes("4k3/8/8/8/P7/8/PPPPPPPP/4K3")

    def test_too_many_pieces(self):
        assert "too_many_pieces" in codes("4k3/8/8/N7/NN6/NNNNNNNN/NNNNNNNN/4K3")


class TestTiles:
    def test_cuts_64_tiles_in_reading_order(self):
        image = np.zeros((800, 800, 3), dtype=np.uint8)
        image[0:100, 0:100] = (255, 0, 0)  # Top left
        image[700:800, 700:800] = (0, 255, 0)  # Bottom right
        tiles = extract_tiles(image, 0, 0, 800, 800)
        assert tiles.shape == (64, TILE_SIZE, TILE_SIZE, 3)
        assert tiles[0].mean(axis=(0, 1)).tolist() == [255, 0, 0]
        assert tiles[63].mean(axis=(0, 1)).tolist() == [0, 255, 0]
        assert tiles[1].sum() == 0

    def test_respects_the_board_position(self):
        image = np.zeros((500, 500, 3), dtype=np.uint8)
        image[50:90, 60:100] = 200
        tiles = extract_tiles(image, 60, 50, 320, 320)
        assert tiles[0].min() == 200

    def test_a_board_slightly_outside_the_image_still_gives_tiles(self):
        image = np.full((320, 320, 3), 77, dtype=np.uint8)
        assert extract_tiles(image, -2.5, -2.5, 325, 325).shape[0] == 64

    def test_small_boards_are_enlarged_to_the_tile_size(self):
        image = np.full((128, 128, 3), 77, dtype=np.uint8)
        assert extract_tiles(image, 0, 0, 128, 128).shape[1] == TILE_SIZE

    def test_model_input_shape_and_range(self):
        tiles = np.full((2, TILE_SIZE, TILE_SIZE, 3), 255, dtype=np.uint8)
        data = to_model_input(tiles)
        assert data.shape == (2, 3, TILE_SIZE, TILE_SIZE)
        assert data.max() == 1.0
        assert data.dtype == np.float32

    def test_labels_cover_the_board_labels(self):
        assert set(LABELS) == set(parse_placement(START).values()) | {"empty"}
