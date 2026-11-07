/** Reviews the moves played in a session. One position alone has no history to judge. */
import { Chess, type Color } from "chess.js";
import type { Engine } from "./engine";
import { judgeMove, lineToSan, looksBrilliant, type MoveQuality } from "./evaluation";
import type { Score } from "./uci";

const REVIEW_DEPTH = 12;
const REVIEW_MOVETIME_MS = 500;

export interface PlayedMove {
  readonly san: string;
  readonly color: Color;
  readonly before: string;
  readonly after: string;
}

export interface MoveReview {
  readonly ply: number;
  readonly san: string;
  readonly color: Color;
  readonly quality: MoveQuality | null;
  /** What the engine preferred, when it differs from the move played. */
  readonly better: string | null;
  /** The engine's expected continuation after the move, in standard notation. */
  readonly followUp: readonly string[];
}

export interface GameReview {
  readonly moves: readonly MoveReview[];
}

/** A finished position needs no search, because its value is already known. */
function finishedScore(fen: string): Score | null {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return { kind: "mate", value: chess.turn() === "w" ? -1 : 1 };
  if (chess.isDraw()) return { kind: "cp", value: 0 };
  return null;
}

async function evaluate(engine: Engine, fen: string, signal: AbortSignal) {
  const known = finishedScore(fen);
  if (known) return { score: known, best: null as string | null, pv: [] as readonly string[] };
  const handle = engine.search({ fen, depth: REVIEW_DEPTH, movetimeMs: REVIEW_MOVETIME_MS, multipv: 1 });
  const onAbort = () => handle.cancel();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const result = await handle.promise;
    const line = result.lines[0];
    return { score: line?.score ?? null, best: result.bestMove, pv: line?.pv ?? [] };
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** Returns null if cancelled. Rejects with EngineError if the engine fails. */
export async function reviewGame(
  engine: Engine,
  moves: readonly PlayedMove[],
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<GameReview | null> {
  const reviewed: MoveReview[] = [];
  let beforeResult = moves[0] ? await evaluate(engine, moves[0].before, signal) : null;

  for (const [ply, move] of moves.entries()) {
    if (signal.aborted || !beforeResult) return null;
    const afterResult = await evaluate(engine, move.after, signal);
    if (signal.aborted) return null;

    let quality: MoveQuality | null = null;
    if (beforeResult.score && afterResult.score) {
      quality = judgeMove(beforeResult.score, afterResult.score, move.color);
      if (!quality && looksBrilliant(move.before, move.san, beforeResult.score, afterResult.score, afterResult.pv, beforeResult.best)) {
        quality = "brilliant";
      }
    }
    const betterSan = beforeResult.best ? lineToSan(move.before, [beforeResult.best], 1)[0] : undefined;
    reviewed.push({
      ply,
      san: move.san,
      color: move.color,
      quality,
      better: betterSan && betterSan !== move.san ? betterSan : null,
      followUp: lineToSan(move.after, afterResult.pv, 4),
    });
    beforeResult = afterResult;
    onProgress(ply + 1, moves.length);
  }
  return { moves: reviewed };
}

export function reviewMatches(review: GameReview, moves: readonly PlayedMove[], ply: number): boolean {
  return review.moves[ply]?.san === moves[ply]?.san;
}
