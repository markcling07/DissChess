import pytest
from ptc_vision.board import ALL_SQUARES, parse_placement, rotate_board, rotate_square, to_placement

START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"
MIDGAME = "r1bq1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1"


def test_parse_places_pieces_on_the_right_squares():
    board = parse_placement(START)
    assert len(board) == 64
    assert set(board) == set(ALL_SQUARES)
    assert board["e1"] == "K"
    assert board["e8"] == "k"
    assert board["a2"] == "P"
    assert board["h7"] == "p"
    assert board["e4"] == "empty"


@pytest.mark.parametrize("placement", [START, MIDGAME, "8/8/8/8/8/8/8/8", "k7/8/8/8/8/8/8/7K"])
def test_round_trip(placement):
    assert to_placement(parse_placement(placement)) == placement


@pytest.mark.parametrize(
    "placement",
    [
        "",
        "8/8/8/8/8/8/8",
        "8/8/8/8/8/8/8/8/8",
        "9/8/8/8/8/8/8/8",
        "ppppppppp/8/8/8/8/8/8/8",
        "ppppppp/8/8/8/8/8/8/8",
        "x7/8/8/8/8/8/8/8",
        "44/8/8/8/8/8/8/8",
        "0p7/8/8/8/8/8/8/8",
    ],
)
def test_malformed_placements_are_rejected(placement):
    with pytest.raises(ValueError):
        parse_placement(placement)


@pytest.mark.parametrize(
    ("start", "turns", "end"),
    [("a1", 1, "a8"), ("a8", 1, "h8"), ("h8", 1, "h1"), ("h1", 1, "a1"), ("e2", 2, "d7")],
)
def test_rotate_square(start, turns, end):
    assert rotate_square(start, turns) == end


def test_four_quarter_turns_restore_the_board():
    board = parse_placement(MIDGAME)
    assert rotate_board(board, 4) == board
    assert rotate_board(rotate_board(board, 1), 3) == board
    assert rotate_board(board, 1) != board
