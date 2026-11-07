/** Turns engine scores into things a person can read, and judges moves from them. */
import { Chess, type Color } from "chess.js";
import type { EngineLine } from "./engine";
import { parseUciMove, type Score } from "./uci";

const NAME: Record<Color, string> = { w: "White", b: "Black" };

/**
 * White's chance of winning, from 0 to 100. The curve is the one Lichess publishes for its analysis.
 * Centipawns matter less the further ahead someone is, so this suits comparing moves better than
 * the raw score does.
 */
export function winPercent(score: Score): number {
  if (score.kind === "mate") return score.value > 0 ? 100 : score.value < 0 ? 0 : 50;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * score.value)) - 1);
}

export function formatScore(score: Score): string {
  if (score.kind === "mate") {
    const side = score.value > 0 ? "White" : "Black";
    return `${side} mates in ${Math.abs(score.value)}`;
  }
  const pawns = score.value / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

export function describeScore(score: Score): string {
  if (score.kind === "mate") return formatScore(score);
  const size = Math.abs(score.value);
  const side = score.value > 0 ? "White" : "Black";
  if (size < 30) return "About equal";
  if (size < 100) return `${side} is slightly better`;
  if (size < 300) return `${side} is better`;
  return `${side} is winning`;
}

/** Plays out an engine line and returns it in chess notation, stopping if it turns illegal. */
export function lineToSan(fen: string, pv: readonly string[], limit = 8): string[] {
  const chess = new Chess(fen);
  const moves: string[] = [];
  for (const uci of pv.slice(0, limit)) {
    try {
      moves.push(chess.move(parseUciMove(uci)).san);
    } catch {
      break;
    }
  }
  return moves;
}

/** Writes moves with numbers, as in "12... Nf6 13. Bg5". */
export function numberMoves(fen: string, sans: readonly string[]): string {
  const chess = new Chess(fen);
  let number = chess.moveNumber();
  let color = chess.turn();
  const parts: string[] = [];
  sans.forEach((san, index) => {
    if (color === "w") parts.push(`${number}. ${san}`);
    else parts.push(index === 0 ? `${number}... ${san}` : san);
    if (color === "b") number += 1;
    color = color === "w" ? "b" : "w";
  });
  return parts.join(" ");
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function materialFor(chess: Chess, side: Color): number {
  let total = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece) total += (piece.color === side ? 1 : -1) * PIECE_VALUE[piece.type]!;
    }
  }
  return total;
}

/** A position with the other side to move, as if the side to move had passed. */
export function passedFen(fen: string): string {
  const fields = fen.split(" ");
  fields[1] = fields[1] === "w" ? "b" : "w";
  fields[3] = "-";
  return fields.join(" ");
}

export interface Insight {
  readonly kind: "mate" | "being_mated" | "only_move" | "wins_material";
  readonly text: string;
}

/**
 * Plain observations drawn from the engine's lines. These are simple checks on what it found, and
 * not a full understanding of the position, so they're labelled as such where they're shown.
 */
export function findInsights(fen: string, lines: readonly EngineLine[]): Insight[] {
  const best = lines[0];
  if (!best?.pv.length) return [];
  const chess = new Chess(fen);
  const side = chess.turn();
  const name = NAME[side];
  const san = lineToSan(fen, best.pv, 1)[0];
  if (!san) return [];

  const forSide = best.score.value * (side === "w" ? 1 : -1);
  const insights: Insight[] = [];

  if (best.score.kind === "mate" && forSide > 0) {
    insights.push({ kind: "mate", text: `${name} has checkmate in ${forSide}, starting with ${san}.` });
    return insights;
  }
  if (best.score.kind === "mate" && forSide < 0) {
    insights.push({
      kind: "being_mated",
      text: `${name} can't avoid checkmate in ${-forSide}. ${san} holds out longest.`,
    });
    return insights;
  }

  const second = lines[1];
  if (second) {
    const direction = side === "w" ? 1 : -1;
    const gap = direction * (winPercent(best.score) - winPercent(second.score));
    if (gap >= 15) {
      insights.push({ kind: "only_move", text: `${san} is much stronger than any other move here.` });
    }
  }

  // Compared after the other side's reply, so a capture that gets recaptured doesn't count.
  const replay = new Chess(fen);
  const before = materialFor(replay, side);
  const plies = best.pv.length >= 6 ? 6 : best.pv.length - (best.pv.length % 2);
  let played = 0;
  for (const uci of best.pv.slice(0, plies)) {
    try {
      replay.move(parseUciMove(uci));
      played += 1;
    } catch {
      break;
    }
  }
  const gain = materialFor(replay, side) - before;
  if (played === plies && plies >= 2 && gain >= 2) {
    insights.push({
      kind: "wins_material",
      text: `${san} looks set to win material, about ${gain} points.`,
    });
  }
  return insights;
}

export type MoveQuality = "brilliant" | "inaccuracy" | "mistake" | "blunder";

export const QUALITY_MARK: Record<MoveQuality, string> = {
  brilliant: "!!",
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
};

export const QUALITY_NAME: Record<MoveQuality, string> = {
  brilliant: "Brilliant",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  blunder: "Blunder",
};

export function isError(quality: MoveQuality | null): boolean {
  return quality !== null && quality !== "brilliant";
}

/**
 * Judges a move by how much it lowered the mover's chance of winning, using the same thresholds as
 * Lichess: 5, 10 and 15 points on this 0 to 100 scale.
 */
export function judgeMove(before: Score, after: Score, mover: Color): MoveQuality | null {
  const direction = mover === "w" ? 1 : -1;
  const lost = direction * (winPercent(before) - winPercent(after));
  if (lost >= 15) return "blunder";
  if (lost >= 10) return "mistake";
  if (lost >= 5) return "inaccuracy";
  return null;
}

/**
 * How much of its win chance a sound sacrifice may give up, on the 0 to 100 scale, when it isn't the
 * engine's own first choice. The engine's first choice may show a small loss too, from search noise,
 * so that only needs to stay short of an inaccuracy.
 */
const SACRIFICE_SLACK = 2;
const NOISE_SLACK = 5;
/**
 * Above this chance of winning, about four pawns up, the win chance barely moves, so giving material
 * away looks free even when it isn't. Sacrifices from there aren't judged, except one that keeps the
 * engine's fastest mate.
 */
const ALREADY_WON = 90;
/** Material a move must give up, after the reply, to count as a sacrifice: more than a pawn. */
const SACRIFICE_POINTS = 2;

/**
 * Whether a move looks brilliant: it gives up material, the engine's best replies still leave it
 * down, and yet it keeps the mover's chances and leaves them at least level. This is a simple check
 * of our own. Other sites judge brilliance by their own rules, so they won't always agree.
 *
 * `reply` is the engine's line from the position after the move, and `engineBest` its first choice
 * before it, both in UCI notation.
 */
export function looksBrilliant(
  fenBefore: string,
  san: string,
  before: Score,
  after: Score,
  reply: readonly string[],
  engineBest: string | null = null,
): boolean {
  const chess = new Chess(fenBefore);
  const mover = chess.turn();
  const direction = mover === "w" ? 1 : -1;
  const lost = direction * (winPercent(before) - winPercent(after));
  const moverChance = (score: Score) => (mover === "w" ? winPercent(score) : 100 - winPercent(score));
  if (lost >= NOISE_SLACK || moverChance(after) < 50) return false;
  const mating = before.kind === "mate" && direction * before.value > 0;
  if (!mating && moverChance(before) > ALREADY_WON) return false;

  const start = materialFor(chess, mover);
  let uci: string;
  try {
    const played = chess.move(san);
    uci = `${played.from}${played.to}${played.promotion ?? ""}`;
  } catch {
    return false;
  }
  if (uci !== engineBest && lost > SACRIFICE_SLACK) return false;
  if (mating) {
    const keepsMate =
      uci === engineBest &&
      after.kind === "mate" &&
      direction * after.value > 0 &&
      Math.abs(after.value) <= Math.abs(before.value);
    if (!keepsMate) return false;
  }
  // Checked after each of the other side's replies, up to two, so a trade that wins the piece
  // straight back isn't counted.
  let checked = 0;
  for (const uci of reply.slice(0, 3)) {
    try {
      chess.move(parseUciMove(uci));
    } catch {
      break;
    }
    if (chess.turn() !== mover) continue;
    if (start - materialFor(chess, mover) < SACRIFICE_POINTS) return false;
    checked += 1;
  }
  return checked > 0;
}
