"""Board representation shared by the recognition pipeline and the evaluation tool.

A board is a dict with exactly 64 entries, mapping square names ("a1") to labels.
"""

from typing import Literal, get_args

SquareLabel = Literal["empty", "P", "N", "B", "R", "Q", "K", "p", "n", "b", "r", "q", "k"]

EMPTY: SquareLabel = "empty"
PIECE_LABELS: frozenset[str] = frozenset(get_args(SquareLabel)) - {EMPTY}
FILES = "abcdefgh"
RANKS = "12345678"
ALL_SQUARES: tuple[str, ...] = tuple(f + r for r in RANKS for f in FILES)

type Board = dict[str, SquareLabel]


def parse_placement(placement: str) -> Board:
    """Parse the piece placement field of a FEN (rank 8 first). Raises ValueError if malformed."""
    ranks = placement.split("/")
    if len(ranks) != 8:
        raise ValueError(f"expected 8 ranks, found {len(ranks)}: {placement!r}")

    board: Board = {}
    for rank_text, rank_name in zip(ranks, reversed(RANKS), strict=True):
        file_index = 0
        previous_was_digit = False
        for char in rank_text:
            if char in "12345678":
                if previous_was_digit:
                    raise ValueError(f"consecutive digits in rank {rank_name}: {placement!r}")
                for _ in range(int(char)):
                    if file_index < 8:
                        board[FILES[file_index] + rank_name] = EMPTY
                    file_index += 1
                previous_was_digit = True
            elif char in PIECE_LABELS:
                if file_index < 8:
                    board[FILES[file_index] + rank_name] = char  # type: ignore[assignment]
                file_index += 1
                previous_was_digit = False
            else:
                raise ValueError(f"invalid character {char!r} in placement: {placement!r}")
        if file_index != 8:
            raise ValueError(f"rank {rank_name} has {file_index} squares: {placement!r}")
    return board


def to_placement(board: Board) -> str:
    """Render a board as the canonical piece placement field of a FEN."""
    ranks = []
    for rank in reversed(RANKS):
        text = ""
        empty_run = 0
        for file in FILES:
            label = board[file + rank]
            if label == EMPTY:
                empty_run += 1
                continue
            if empty_run:
                text += str(empty_run)
                empty_run = 0
            text += label
        if empty_run:
            text += str(empty_run)
        ranks.append(text)
    return "/".join(ranks)


def rotate_square(square: str, quarter_turns_cw: int) -> str:
    """Where a square lands after rotating the board clockwise, viewed with White at the bottom."""
    file, rank = FILES.index(square[0]), RANKS.index(square[1])
    for _ in range(quarter_turns_cw % 4):
        file, rank = rank, 7 - file
    return FILES[file] + RANKS[rank]


def rotate_board(board: Board, quarter_turns_cw: int) -> Board:
    return {rotate_square(square, quarter_turns_cw): label for square, label in board.items()}
