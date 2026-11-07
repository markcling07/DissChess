/**
 * Reads a list of moves, as typed by hand or copied from a game page or a PGN file, and plays it
 * through to find the position it reaches. Move numbers in the text are ignored: the moves are
 * numbered from the position itself, so a list that skips or repeats a number still reads.
 */
import { Chess } from "chess.js";

export interface MovesResult {
  /** The position after the last move. */
  readonly fen: string;
  /** How many half-moves were played. */
  readonly played: number;
  /** The last move, numbered like "11... Ng6", or null when the list held no moves. */
  readonly last: string | null;
}

const FIGURINES: Record<string, string> = {
  "♔": "K", "♚": "K",
  "♕": "Q", "♛": "Q",
  "♖": "R", "♜": "R",
  "♗": "B", "♝": "B",
  "♘": "N", "♞": "N",
  "♙": "", "♟": "",
};

const RESULT = /^(1-0|0-1|1\/2-1\/2|½-½|\*)$/;

/** Removes everything that isn't a move: tags, comments, side lines and annotation codes. */
function stripExtras(text: string): string {
  let out = text
    .replace(/^\s*\[[^\]]*\]\s*$/gm, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/;[^\n]*/g, " ")
    .replace(/\$\d+/g, " ");
  // Side lines can nest, so the innermost are removed first until none are left.
  for (let previous = ""; previous !== out; ) {
    previous = out;
    out = out.replace(/\([^()]*\)/g, " ");
  }
  return out;
}

/** Turns one word of the text into a move chess.js can read, or "" if it holds no move. */
function cleanToken(token: string): string {
  let move = token
    .replace(/^\d+\s*(\.+|…)/, "")
    .replace(/[♔♚♕♛♖♜♗♝♘♞♙♟]/g, (figurine) => FIGURINES[figurine] ?? "")
    .replace(/[×:]/g, "x")
    .replace(/[0Oo]-[0Oo]-[0Oo]/, "O-O-O")
    .replace(/[0Oo]-[0Oo]/, "O-O")
    .replace(/e\.p\.?$/i, "")
    .replace(/[!?+#‡†]+$/, "");
  // Results, stray numbers and plain words such as a heading or a player's name.
  if (RESULT.test(move) || /^\d+$/.test(move) || /^[A-Za-z]{3,}$/.test(move)) move = "";
  return move;
}

/** Splits the text into moves. A piece letter or figurine on its own joins the move after it. */
export function moveTokens(text: string): string[] {
  const words = stripExtras(text)
    .replace(/(\d)\s*(\.\.\.|…|\.)/g, "$1$2 ")
    .split(/\s+/)
    .map(cleanToken)
    .filter((move) => move !== "");
  const moves: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    const next = words[i + 1];
    if (/^[KQRBN]$/.test(word) && next !== undefined && /^x?[a-h]/.test(next)) {
      moves.push(word + next);
      i += 1;
    } else {
      moves.push(word);
    }
  }
  return moves;
}

/** The FEN in a PGN's [FEN "..."] tag, if it has one. */
function startingFen(text: string): string | undefined {
  return /^\s*\[\s*FEN\s+"([^"]+)"\s*\]/m.exec(text)?.[1];
}

/**
 * Plays the moves from the standard starting position, or from the FEN tag of a PGN. Throws with a
 * message the user can act on, naming the first move that couldn't be read or played.
 */
export function positionFromMoves(text: string): MovesResult {
  if (text.trim() === "") throw new Error("Enter the moves, like 1. e4 e5 2. Nf3 Nc6.");

  const fen = startingFen(text);
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    throw new Error("The FEN tag in these moves isn't a position that can be played from.");
  }

  const moves = moveTokens(text);
  if (moves.length === 0) throw new Error("No moves were found. Write them like 1. e4 e5 2. Nf3 Nc6.");

  let last: string | null = null;
  for (const move of moves) {
    const number = chess.moveNumber();
    const label = chess.turn() === "w" ? `${number}.` : `${number}...`;
    let san: string;
    try {
      san = chess.move(move).san;
    } catch {
      const side = chess.turn() === "w" ? "White" : "Black";
      throw new Error(
        `Couldn't play ${label} ${move} for ${side}. Check that move and the ones before it.`,
      );
    }
    last = `${label} ${san}`;
  }
  return { fen: chess.fen(), played: chess.history().length, last };
}
