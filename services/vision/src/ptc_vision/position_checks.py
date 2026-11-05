"""Problems visible from the piece layout alone, so uncertain squares can be pointed out.

These never change what was recognised. The web app validates the full position again before play,
including the details that a user supplies.
"""

from ptc_vision.board import Board
from ptc_vision.contract import PositionIssue

COLOUR_NAMES = (("White", "PNBRQK"), ("Black", "pnbrqk"))


def check_layout(board: Board) -> list[PositionIssue]:
    issues: list[PositionIssue] = []
    for name, labels in COLOUR_NAMES:
        king, pawn = labels[5], labels[0]
        kings = [s for s, label in board.items() if label == king]
        pawns = [s for s, label in board.items() if label == pawn]
        pieces = [s for s, label in board.items() if label in labels]
        if not kings:
            issues.append(
                PositionIssue(
                    code="missing_king", severity="blocking", message=f"No {name} king was found."
                )
            )
        elif len(kings) > 1:
            issues.append(
                PositionIssue(
                    code="extra_king",
                    severity="blocking",
                    squares=sorted(kings),
                    message=f"{len(kings)} {name} kings were found.",
                )
            )
        if len(pawns) > 8:
            issues.append(
                PositionIssue(
                    code="too_many_pawns",
                    severity="blocking",
                    squares=sorted(pawns),
                    message=f"{len(pawns)} {name} pawns were found.",
                )
            )
        if len(pieces) > 16:
            issues.append(
                PositionIssue(
                    code="too_many_pieces",
                    severity="blocking",
                    message=f"{len(pieces)} {name} pieces were found.",
                )
            )

    back_rank = sorted(s for s, label in board.items() if label in "Pp" and s[1] in "18")
    if back_rank:
        issues.append(
            PositionIssue(
                code="pawn_on_back_rank",
                severity="blocking",
                squares=back_rank,
                message="Pawns were found on the first or last rank.",
            )
        )
    return issues
