/**
 * The position being set up, before it becomes a game. Unlike a FEN, it can be incomplete or wrong,
 * because the user may still be correcting it.
 */
import { SQUARES, type Color, type Square } from "chess.js";

export type PieceCode =
  | "P"
  | "N"
  | "B"
  | "R"
  | "Q"
  | "K"
  | "p"
  | "n"
  | "b"
  | "r"
  | "q"
  | "k";

export type Placement = ReadonlyMap<Square, PieceCode>;
export type CastlingRight = "K" | "Q" | "k" | "q";
export type Castling = Readonly<Record<CastlingRight, boolean>>;

export interface PositionSetup {
  readonly placement: Placement;
  /** null until the user chooses, because a board can't show whose turn it is. */
  readonly sideToMove: Color | null;
  readonly castling: Castling;
  readonly enPassant: Square | null;
  readonly halfmove: number;
  readonly fullmove: number;
}

export const STANDARD_PLACEMENT = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
export const NO_CASTLING: Castling = { K: false, Q: false, k: false, q: false };
export const ALL_CASTLING: Castling = { K: true, Q: true, k: true, q: true };
export const CASTLING_RIGHTS: readonly CastlingRight[] = ["K", "Q", "k", "q"];

const FILES = "abcdefgh";
const PIECE_CODES = new Set("PNBRQKpnbrqk");

export function squareOf(fileIndex: number, rank: number): Square {
  return `${FILES[fileIndex]}${rank}` as Square;
}

export function pieceColor(piece: PieceCode): Color {
  return piece === piece.toUpperCase() ? "w" : "b";
}

export function emptySetup(): PositionSetup {
  return {
    placement: new Map(),
    sideToMove: null,
    castling: NO_CASTLING,
    enPassant: null,
    halfmove: 0,
    fullmove: 1,
  };
}

export function standardSetup(): PositionSetup {
  return {
    placement: parsePlacement(STANDARD_PLACEMENT),
    sideToMove: "w",
    castling: ALL_CASTLING,
    enPassant: null,
    halfmove: 0,
    fullmove: 1,
  };
}

/** Parses the first field of a FEN. Throws with a message the user can act on. */
export function parsePlacement(text: string): Map<Square, PieceCode> {
  const ranks = text.split("/");
  if (ranks.length !== 8) {
    throw new Error(`The board needs 8 ranks separated by "/", but this has ${ranks.length}.`);
  }
  const placement = new Map<Square, PieceCode>();
  ranks.forEach((rankText, index) => {
    const rank = 8 - index;
    let file = 0;
    let previousWasDigit = false;
    for (const char of rankText) {
      if (char >= "1" && char <= "8") {
        if (previousWasDigit) throw new Error(`Rank ${rank} has two digits in a row.`);
        file += Number(char);
        previousWasDigit = true;
      } else if (PIECE_CODES.has(char)) {
        if (file < 8) placement.set(squareOf(file, rank), char as PieceCode);
        file += 1;
        previousWasDigit = false;
      } else {
        throw new Error(`"${char}" isn't a chess piece.`);
      }
    }
    if (file !== 8) throw new Error(`Rank ${rank} has ${file} squares instead of 8.`);
  });
  return placement;
}

export function toPlacementString(placement: Placement): string {
  const ranks: string[] = [];
  for (let rank = 8; rank >= 1; rank -= 1) {
    let text = "";
    let empty = 0;
    for (let file = 0; file < 8; file += 1) {
      const piece = placement.get(squareOf(file, rank));
      if (piece) {
        if (empty) text += empty;
        empty = 0;
        text += piece;
      } else {
        empty += 1;
      }
    }
    if (empty) text += empty;
    ranks.push(text);
  }
  return ranks.join("/");
}

/** Writes a FEN. Only call once a side to move has been chosen. */
export function toFen(setup: PositionSetup): string {
  if (!setup.sideToMove) throw new Error("A FEN needs a side to move.");
  const castling = CASTLING_RIGHTS.filter((right) => setup.castling[right]).join("") || "-";
  return [
    toPlacementString(setup.placement),
    setup.sideToMove,
    castling,
    setup.enPassant ?? "-",
    setup.halfmove,
    setup.fullmove,
  ].join(" ");
}

/**
 * Reads a FEN for the editor. Only the shape is checked here, because a position with problems
 * should still load so the user can fix it. Missing trailing fields stay unset rather than guessed.
 */
export function parseFen(text: string): PositionSetup {
  const fields = text.trim().split(/\s+/);
  const [placementText, side, castlingText, enPassantText, halfmoveText, fullmoveText] = fields;
  if (!placementText) throw new Error("Enter a FEN.");
  if (fields.length > 6) throw new Error("A FEN has at most 6 fields.");

  // Checked first, so text that isn't a FEN at all gets the most useful message.
  const placement = parsePlacement(placementText);

  if (side !== undefined && side !== "w" && side !== "b") {
    throw new Error('The side to move must be "w" or "b".');
  }
  if (castlingText !== undefined && !/^(-|K?Q?k?q?)$/.test(castlingText)) {
    throw new Error('Castling must be "-" or letters from KQkq, in that order.');
  }
  if (enPassantText !== undefined && enPassantText !== "-" && !SQUARES.includes(enPassantText as Square)) {
    throw new Error('The en passant field must be "-" or a square.');
  }

  return {
    placement,
    sideToMove: side ?? null,
    castling: {
      K: castlingText?.includes("K") ?? false,
      Q: castlingText?.includes("Q") ?? false,
      k: castlingText?.includes("k") ?? false,
      q: castlingText?.includes("q") ?? false,
    },
    enPassant: enPassantText === undefined || enPassantText === "-" ? null : (enPassantText as Square),
    halfmove: parseCounter(halfmoveText, 0, "halfmove clock"),
    fullmove: parseCounter(fullmoveText, 1, "move number"),
  };
}

function parseCounter(text: string | undefined, fallback: number, name: string): number {
  if (text === undefined) return fallback;
  if (!/^\d+$/.test(text)) throw new Error(`The ${name} must be a whole number.`);
  return Number(text);
}

/** Rotates the pieces clockwise, as seen with White at the bottom: a1 goes to a8. */
export function rotatePlacement(placement: Placement): Map<Square, PieceCode> {
  const rotated = new Map<Square, PieceCode>();
  for (const [square, piece] of placement) {
    const file = FILES.indexOf(square[0]!);
    const rank = Number(square[1]) - 1;
    rotated.set(squareOf(rank, 8 - file), piece);
  }
  return rotated;
}

const CASTLING_SQUARES: Record<CastlingRight, { king: Square; rook: Square }> = {
  K: { king: "e1", rook: "h1" },
  Q: { king: "e1", rook: "a1" },
  k: { king: "e8", rook: "h8" },
  q: { king: "e8", rook: "a8" },
};

/** Whether the king and rook are on their home squares, which castling requires. */
export function canHoldCastlingRight(placement: Placement, right: CastlingRight): boolean {
  const { king, rook } = CASTLING_SQUARES[right];
  const isWhite = right === right.toUpperCase();
  return placement.get(king) === (isWhite ? "K" : "k") && placement.get(rook) === (isWhite ? "R" : "r");
}

/** Whether the board shows the result of a two-square pawn push onto this en passant target. */
export function isEnPassantConsistent(placement: Placement, side: Color, target: Square): boolean {
  const file = FILES.indexOf(target[0]!);
  const targetRank = side === "w" ? 6 : 3;
  if (Number(target[1]) !== targetRank) return false;
  const pawnRank = side === "w" ? 5 : 4;
  const originRank = side === "w" ? 7 : 2;
  return (
    !placement.has(target) &&
    !placement.has(squareOf(file, originRank)) &&
    placement.get(squareOf(file, pawnRank)) === (side === "w" ? "p" : "P")
  );
}

/** En passant targets worth offering: the board allows them and a pawn could make the capture. */
export function enPassantOptions(placement: Placement, side: Color): Square[] {
  const options: Square[] = [];
  const pawnRank = side === "w" ? 5 : 4;
  const capturer = side === "w" ? "P" : "p";
  const targetRank = side === "w" ? 6 : 3;
  for (let file = 0; file < 8; file += 1) {
    const target = squareOf(file, targetRank);
    if (!isEnPassantConsistent(placement, side, target)) continue;
    const hasCapturer =
      (file > 0 && placement.get(squareOf(file - 1, pawnRank)) === capturer) ||
      (file < 7 && placement.get(squareOf(file + 1, pawnRank)) === capturer);
    if (hasCapturer) options.push(target);
  }
  return options;
}
