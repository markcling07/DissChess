"""Generates positions and expected results from python-chess, an independent rules implementation.

The web app's tests check chess.js and the position validator against this file. Regenerate with:
    .venv/Scripts/python apps/web/scripts/generate_rules_fixture.py
"""

import json
import random
from pathlib import Path

import chess

OUTPUT = Path(__file__).resolve().parents[1] / "src" / "chess" / "rules-crosscheck.json"
SEED = 20261105
PLAYOUTS = 120
SAMPLES_PER_PLAYOUT = 3
RANDOM_LAYOUTS = 600
MAX_PLAYOUT_PLIES = 500

# Each game also keeps its final position, so checkmates and stalemates are covered.
RICH_STARTS = [
    chess.STARTING_FEN,
    "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
    "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
    "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
]

# Flags this project's validator is expected to agree with. IMPOSSIBLE_CHECK is left out because
# the validator doesn't attempt retrograde analysis of how a check could have arisen.
VALIDATOR_FLAGS = {
    "NO_WHITE_KING",
    "NO_BLACK_KING",
    "TOO_MANY_KINGS",
    "TOO_MANY_WHITE_PAWNS",
    "TOO_MANY_BLACK_PAWNS",
    "PAWNS_ON_BACKRANK",
    "TOO_MANY_WHITE_PIECES",
    "TOO_MANY_BLACK_PIECES",
    "BAD_CASTLING_RIGHTS",
    "INVALID_EP_SQUARE",
    "OPPOSITE_CHECK",
    "EMPTY",
    "TOO_MANY_CHECKERS",
}


def rules_case(board: chess.Board) -> dict:
    return {
        "fen": board.fen(en_passant="fen"),
        "legal": sorted(move.uci() for move in board.legal_moves),
        "check": board.is_check(),
        "checkmate": board.is_checkmate(),
        "stalemate": board.is_stalemate(),
    }


def playout_cases(rng: random.Random) -> list[dict]:
    cases = {}
    for index in range(PLAYOUTS):
        board = chess.Board(RICH_STARTS[index % len(RICH_STARTS)])
        cases[board.fen(en_passant="fen")] = rules_case(board)
        sample_at = set(rng.sample(range(MAX_PLAYOUT_PLIES // 2), SAMPLES_PER_PLAYOUT))
        for ply in range(MAX_PLAYOUT_PLIES):
            legal = list(board.legal_moves)
            if not legal:
                cases[board.fen(en_passant="fen")] = rules_case(board)
                break
            board.push(rng.choice(legal))
            if ply in sample_at:
                cases[board.fen(en_passant="fen")] = rules_case(board)
    return list(cases.values())


def random_layout(rng: random.Random) -> str:
    board = chess.Board(None)
    squares = list(chess.SQUARES)
    rng.shuffle(squares)

    if rng.random() < 0.5:
        # Home squares, so castling rights are sometimes genuinely valid
        for square, piece in [
            (chess.E1, "K"),
            (chess.E8, "k"),
            (chess.A1, "R"),
            (chess.H1, "R"),
            (chess.A8, "r"),
            (chess.H8, "r"),
        ]:
            board.set_piece_at(square, chess.Piece.from_symbol(piece))
    else:
        for piece in "Kk":
            if rng.random() < 0.95:
                board.set_piece_at(squares.pop(), chess.Piece.from_symbol(piece))
    if rng.random() < 0.03:
        board.set_piece_at(squares.pop(), chess.Piece.from_symbol(rng.choice("Kk")))

    extra = rng.choice([0, 2, 4, 8, 16, 24, 34])
    for _ in range(extra):
        square = squares.pop()
        symbol = rng.choice("PPPNBRQppPnbrq")
        if board.piece_at(square) is None:
            board.set_piece_at(square, chess.Piece.from_symbol(symbol))

    side = rng.choice("wb")
    castling = "".join(c for c in "KQkq" if rng.random() < 0.3) or "-"
    ep = "-"
    if rng.random() < 0.3:
        ep = rng.choice("abcdefgh") + rng.choice("36")
        if rng.random() < 0.6:
            # Make the en passant square consistent, so valid cases do occur
            file = chess.FILE_NAMES.index(ep[0])
            rank = 5 if side == "w" else 2
            ep = chess.FILE_NAMES[file] + str(rank + 1)
            pawn_rank = 4 if side == "w" else 3
            origin_rank = 6 if side == "w" else 1
            pawn = "p" if side == "w" else "P"
            board.set_piece_at(chess.square(file, pawn_rank), chess.Piece.from_symbol(pawn))
            board.remove_piece_at(chess.square(file, rank))
            board.remove_piece_at(chess.square(file, origin_rank))
    return f"{board.board_fen()} {side} {castling} {ep} 0 1"


def validity_case(fen: str) -> dict:
    board = chess.Board(fen)
    status = board.status()
    flags = {f.name for f in chess.Status if f.value and f in status and f.name in VALIDATOR_FLAGS}

    # python-chess silently drops a right it can't apply when reading a FEN, so status() can't see
    # it. The project's validator reports those, so compare the requested rights directly.
    clean = board.clean_castling_rights()
    requested = fen.split()[2]
    rooks = {"K": chess.BB_H1, "Q": chess.BB_A1, "k": chess.BB_H8, "q": chess.BB_A8}
    if any(right in requested and not clean & rook for right, rook in rooks.items()):
        flags.add("BAD_CASTLING_RIGHTS")
    return {"fen": fen, "flags": sorted(flags)}


def main() -> None:
    rng = random.Random(SEED)
    fixture = {
        "generated_by": f"python-chess {chess.__version__}",
        "rules": playout_cases(rng),
        "validity": [validity_case(random_layout(rng)) for _ in range(RANDOM_LAYOUTS)],
    }
    OUTPUT.write_text(json.dumps(fixture, separators=(",", ":")) + "\n", encoding="utf-8")
    rules = fixture["rules"]
    validity = fixture["validity"]
    print(
        f"{len(rules)} rule cases, {sum(c['checkmate'] for c in rules)} checkmates, "
        f"{sum(c['stalemate'] for c in rules)} stalemates; "
        f"{len(validity)} layouts, {sum(not c['flags'] for c in validity)} valid"
    )


if __name__ == "__main__":
    main()
