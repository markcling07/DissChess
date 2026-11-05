/** Parses the text protocol Stockfish speaks. */
import type { Color } from "chess.js";

export type Score = { readonly kind: "cp"; readonly value: number } | { readonly kind: "mate"; readonly value: number };

export interface InfoLine {
  readonly depth: number;
  readonly multipv: number;
  /** From the side to move's point of view, as Stockfish reports it. */
  readonly score: Score;
  readonly pv: readonly string[];
}

/** Reads a search progress line. Returns null for anything without a full, exact score and line. */
export function parseInfo(line: string): InfoLine | null {
  if (!line.startsWith("info ")) return null;
  const tokens = line.split(/\s+/);
  let depth: number | null = null;
  let multipv = 1;
  let score: Score | null = null;
  let pv: string[] = [];

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "string") return null;
    if (token === "depth") {
      depth = Number(tokens[index + 1]);
      index += 1;
    } else if (token === "multipv") {
      multipv = Number(tokens[index + 1]);
      index += 1;
    } else if (token === "score") {
      const kind = tokens[index + 1];
      const value = Number(tokens[index + 2]);
      if ((kind !== "cp" && kind !== "mate") || !Number.isFinite(value)) return null;
      // A bound only says the true score is above or below this, so it isn't shown.
      if (tokens[index + 3] === "lowerbound" || tokens[index + 3] === "upperbound") return null;
      score = { kind, value };
      index += 2;
    } else if (token === "pv") {
      pv = tokens.slice(index + 1);
      break;
    }
  }

  if (depth === null || !Number.isFinite(depth) || score === null || pv.length === 0) return null;
  return { depth, multipv, score, pv };
}

/** Undefined if this isn't a bestmove line, and null if the side to move has no legal move. */
export function parseBestMove(line: string): string | null | undefined {
  if (!line.startsWith("bestmove")) return undefined;
  const move = line.split(/\s+/)[1];
  return !move || move === "(none)" ? null : move;
}

/** Turns a score from the side to move's point of view into White's. */
export function toWhiteView(score: Score, turn: Color): Score {
  return turn === "w" ? score : { kind: score.kind, value: -score.value };
}

export function parseUciMove(move: string): { from: string; to: string; promotion?: string } {
  const promotion = move[4];
  return { from: move.slice(0, 2), to: move.slice(2, 4), ...(promotion ? { promotion } : {}) };
}
