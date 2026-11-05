/**
 * Decides whether a position may become a game. Blocking issues would break the rules engine or
 * can't occur in chess. Warnings are unusual but playable, and the user may go ahead after seeing.
 *
 * chess.js doesn't check castling rights against the board when it loads a FEN, so this must run
 * first: a right with no rook behind it could otherwise produce an illegal castling move.
 */
import type { PositionIssue as ContractIssue } from "@photo-to-chess/contract";
import { Chess, type Color, type Square } from "chess.js";
import {
  CASTLING_RIGHTS,
  canHoldCastlingRight,
  isEnPassantConsistent,
  pieceColor,
  toPlacementString,
  type PieceCode,
  type Placement,
  type PositionSetup,
} from "./position";

export type IssueCode =
  | ContractIssue["code"]
  | "side_to_move_missing"
  | "side_not_to_move_in_check"
  | "both_kings_in_check"
  | "too_many_checkers"
  | "castling_invalid"
  | "en_passant_invalid"
  | "counters_invalid"
  | "halfmove_after_en_passant";

export interface Issue {
  readonly code: IssueCode;
  readonly severity: "blocking" | "warning";
  readonly squares: readonly Square[];
  readonly message: string;
}

const COLOR_NAME: Record<Color, string> = { w: "White", b: "Black" };
const CAPITALISE: Record<Color, (piece: string) => PieceCode> = {
  w: (piece) => piece.toUpperCase() as PieceCode,
  b: (piece) => piece.toLowerCase() as PieceCode,
};

function squaresWith(placement: Placement, piece: PieceCode): Square[] {
  return [...placement].filter(([, p]) => p === piece).map(([square]) => square);
}

function isLightSquare(square: Square): boolean {
  return (square.charCodeAt(0) - 97 + Number(square[1]) - 1) % 2 === 1;
}

function areAdjacent(a: Square, b: Square): boolean {
  const fileGap = Math.abs(a.charCodeAt(0) - b.charCodeAt(0));
  const rankGap = Math.abs(Number(a[1]) - Number(b[1]));
  return Math.max(fileGap, rankGap) === 1;
}

/** Pieces giving check to each king. Null unless each side has exactly one king. */
function findCheckers(placement: Placement): Record<Color, Square[]> | null {
  const [whiteKing, ...extraWhite] = squaresWith(placement, "K");
  const [blackKing, ...extraBlack] = squaresWith(placement, "k");
  if (!whiteKing || !blackKing || extraWhite.length || extraBlack.length) return null;
  const board = new Chess(`${toPlacementString(placement)} w - - 0 1`, { skipValidation: true });
  return { w: board.attackers(whiteKing, "b"), b: board.attackers(blackKing, "w") };
}

/** The side that must be to move because its king is in check, if the board settles it. */
export function forcedSideToMove(placement: Placement): Color | null {
  const checkers = findCheckers(placement);
  if (!checkers) return null;
  const whiteChecked = checkers.w.length > 0;
  const blackChecked = checkers.b.length > 0;
  if (whiteChecked === blackChecked) return null;
  return whiteChecked ? "w" : "b";
}

export function validatePosition(setup: PositionSetup): Issue[] {
  return [
    ...materialIssues(setup.placement),
    ...checkIssues(setup),
    ...castlingIssues(setup),
    ...enPassantIssues(setup),
    ...counterIssues(setup),
  ];
}

export function hasBlockingIssue(issues: readonly Issue[]): boolean {
  return issues.some((issue) => issue.severity === "blocking");
}

function materialIssues(placement: Placement): Issue[] {
  const issues: Issue[] = [];

  for (const color of ["w", "b"] as const) {
    const name = COLOR_NAME[color];
    const code = CAPITALISE[color];
    const kings = squaresWith(placement, code("k"));
    const pawns = squaresWith(placement, code("p"));
    const pieceCount = [...placement.values()].filter((p) => pieceColor(p) === color).length;

    if (kings.length === 0) {
      issues.push({
        code: "missing_king",
        severity: "blocking",
        squares: [],
        message: `${name} has no king. Add one.`,
      });
    } else if (kings.length > 1) {
      issues.push({
        code: "extra_king",
        severity: "blocking",
        squares: kings,
        message: `${name} has ${kings.length} kings. Remove all but one.`,
      });
    }
    if (pawns.length > 8) {
      issues.push({
        code: "too_many_pawns",
        severity: "blocking",
        squares: pawns,
        message: `${name} has ${pawns.length} pawns. The most possible is 8.`,
      });
    }
    if (pieceCount > 16) {
      issues.push({
        code: "too_many_pieces",
        severity: "blocking",
        // Any of them could be the mistake, and marking them all would only hide the board.
        squares: [],
        message: `${name} has ${pieceCount} pieces. The most possible is 16.`,
      });
    }

    // Each piece beyond the starting set must be a promoted pawn, so it uses up a missing pawn.
    const bishops = squaresWith(placement, code("b"));
    const lightBishops = bishops.filter(isLightSquare).length;
    const extras =
      Math.max(0, squaresWith(placement, code("q")).length - 1) +
      Math.max(0, squaresWith(placement, code("r")).length - 2) +
      Math.max(0, squaresWith(placement, code("n")).length - 2) +
      Math.max(0, lightBishops - 1) +
      Math.max(0, bishops.length - lightBishops - 1);
    if (extras > 8 - pawns.length) {
      issues.push({
        code: "impossible_promotion_count",
        severity: "warning",
        squares: [],
        message: `${name} has more promoted pieces than missing pawns. Check for misplaced pieces.`,
      });
    }
  }

  const backRankPawns = [...placement]
    .filter(([square, piece]) => "Pp".includes(piece) && "18".includes(square[1]!))
    .map(([square]) => square);
  if (backRankPawns.length) {
    issues.push({
      code: "pawn_on_back_rank",
      severity: "blocking",
      squares: backRankPawns,
      message: "Pawns can't stand on the first or last rank. Move or change them.",
    });
  }

  return issues;
}

function checkIssues({ placement, sideToMove }: PositionSetup): Issue[] {
  const issues: Issue[] = [];
  if (!sideToMove) {
    issues.push({
      code: "side_to_move_missing",
      severity: "blocking",
      squares: [],
      message: "Choose whose turn it is.",
    });
  }

  const [whiteKing] = squaresWith(placement, "K");
  const [blackKing] = squaresWith(placement, "k");
  const checkers = findCheckers(placement);
  if (!checkers || !whiteKing || !blackKing) return issues;

  if (areAdjacent(whiteKing, blackKing)) {
    issues.push({
      code: "kings_adjacent",
      severity: "blocking",
      squares: [whiteKing, blackKing],
      message: "The kings can't stand next to each other.",
    });
    return issues;
  }

  if (checkers.w.length && checkers.b.length) {
    issues.push({
      code: "both_kings_in_check",
      severity: "blocking",
      squares: [whiteKing, blackKing],
      message: "Both kings are in check, which can't happen.",
    });
    return issues;
  }

  for (const color of ["w", "b"] as const) {
    const attackers = checkers[color];
    if (attackers.length > 2) {
      const king = color === "w" ? whiteKing : blackKing;
      issues.push({
        code: "too_many_checkers",
        severity: "blocking",
        squares: [king, ...attackers],
        message: `${attackers.length} pieces are checking the ${COLOR_NAME[color]} king. The most possible is 2.`,
      });
    }
    if (attackers.length && sideToMove && sideToMove !== color) {
      const king = color === "w" ? whiteKing : blackKing;
      issues.push({
        code: "side_not_to_move_in_check",
        severity: "blocking",
        squares: [king],
        message: `${COLOR_NAME[color]} is in check, so it must be ${COLOR_NAME[color]}'s turn.`,
      });
    }
  }
  return issues;
}

function castlingIssues({ placement, castling }: PositionSetup): Issue[] {
  const invalid = CASTLING_RIGHTS.filter(
    (right) => castling[right] && !canHoldCastlingRight(placement, right),
  );
  if (!invalid.length) return [];
  return [
    {
      code: "castling_invalid",
      severity: "blocking",
      squares: [],
      message: `Castling ${invalid.join(", ")} needs the king and rook on their home squares.`,
    },
  ];
}

function enPassantIssues({ placement, sideToMove, enPassant, halfmove }: PositionSetup): Issue[] {
  if (!enPassant || !sideToMove) return [];
  if (!isEnPassantConsistent(placement, sideToMove, enPassant)) {
    return [
      {
        code: "en_passant_invalid",
        severity: "blocking",
        squares: [enPassant],
        message: `En passant on ${enPassant} doesn't match the board. It needs a pawn that just moved two squares.`,
      },
    ];
  }
  if (halfmove !== 0) {
    return [
      {
        code: "halfmove_after_en_passant",
        severity: "warning",
        squares: [],
        message: "The halfmove clock should be 0 straight after a pawn move.",
      },
    ];
  }
  return [];
}

function counterIssues({ halfmove, fullmove }: PositionSetup): Issue[] {
  const valid =
    Number.isSafeInteger(halfmove) && halfmove >= 0 && Number.isSafeInteger(fullmove) && fullmove >= 1;
  if (valid) return [];
  return [
    {
      code: "counters_invalid",
      severity: "blocking",
      squares: [],
      message: "The halfmove clock must be 0 or more, and the move number 1 or more.",
    },
  ];
}
