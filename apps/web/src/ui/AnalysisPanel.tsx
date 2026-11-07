import type { Square } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { EngineError } from "../engine/engine";
import {
  describeScore,
  findInsights,
  formatScore,
  isError,
  lineToSan,
  numberMoves,
  QUALITY_MARK,
  QUALITY_NAME,
  winPercent,
} from "../engine/evaluation";
import { reviewGame, type GameReview, type PlayedMove } from "../engine/review";
import { ENGINE_UNAVAILABLE, getEngine } from "../engine/sharedEngine";
import { parseUciMove } from "../engine/uci";
import { useAnalysis } from "../engine/useAnalysis";


/** Live engine analysis of the current position, with a review of the moves played so far. */
export function AnalysisPanel({
  fen,
  paused,
  moves,
  review,
  onReview,
  onBestMove,
}: {
  fen: string;
  /** While the computer opponent is thinking, the one engine is busy with that. */
  paused: boolean;
  moves: readonly PlayedMove[];
  review: GameReview | null;
  onReview: (review: GameReview | null) => void;
  onBestMove: (move: { from: Square; to: Square } | null) => void;
}) {
  const engine = useMemo(() => getEngine(), []);
  const analysis = useAnalysis(engine, fen, !paused);
  const best = analysis.lines[0];
  const bestUci = best?.pv[0];

  useEffect(() => {
    if (!bestUci) {
      onBestMove(null);
      return;
    }
    const { from, to } = parseUciMove(bestUci);
    onBestMove({ from: from as Square, to: to as Square });
  }, [bestUci, onBestMove]);

  useEffect(() => () => onBestMove(null), [onBestMove]);

  const insights = useMemo(() => findInsights(fen, analysis.lines), [fen, analysis.lines]);

  if (analysis.status === "failed") {
    return (
      <section className="analysis" aria-label="Analysis">
        <p className="input__problem" role="alert">
          {ENGINE_UNAVAILABLE}
        </p>
      </section>
    );
  }

  return (
    <section className="analysis" aria-label="Analysis">
      {paused ? (
        <p className="hint">Analysis continues after the computer moves.</p>
      ) : analysis.status === "done" && analysis.lines.length === 0 ? (
        <p className="hint">The game is over, so there's nothing left to analyse.</p>
      ) : !best ? (
        <p className="hint" role="status">
          Starting the chess engine…
        </p>
      ) : (
        <>
          <div className="evaluation" data-testid="evaluation">
            <div className="evaluation__bar" aria-hidden="true">
              <span style={{ width: `${winPercent(best.score)}%` }} />
            </div>
            <p className="evaluation__score">{formatScore(best.score)}</p>
            <p className="evaluation__words">
              {describeScore(best.score)}. Depth {best.depth}.
            </p>
          </div>

          <div>
            <h2 className="analysis__heading">Best moves</h2>
            <ol className="lines">
              {analysis.lines.map((line) => {
                const sans = lineToSan(fen, line.pv);
                return (
                  <li key={line.multipv} className="line">
                    <span className="line__score">{line.score.kind === "mate" ? `M${Math.abs(line.score.value)}` : formatScore(line.score)}</span>
                    <span className="line__moves">{numberMoves(fen, sans)}</span>
                  </li>
                );
              })}
            </ol>
          </div>

          {(insights.length > 0 || analysis.threat) && (
            <div>
              <h2 className="analysis__heading">Worth noticing</h2>
              <ul className="insights">
                {insights.map((insight) => (
                  <li key={insight.kind}>{insight.text}</li>
                ))}
                {analysis.threat && <li>{analysis.threat.text}</li>}
              </ul>
              <p className="hint">Simple checks on the engine's lines, so they won't catch everything.</p>
            </div>
          )}
        </>
      )}

      <MoveReviewSection
        moves={moves}
        review={review}
        onReview={onReview}
        paused={paused}
      />
    </section>
  );
}

function MoveReviewSection({
  moves,
  review,
  onReview,
  paused,
}: {
  moves: readonly PlayedMove[];
  review: GameReview | null;
  onReview: (review: GameReview | null) => void;
  paused: boolean;
}) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function start() {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setFailed(false);
    setProgress({ done: 0, total: moves.length });
    try {
      const result = await reviewGame(
        getEngine(),
        moves,
        (done, total) => setProgress({ done, total }),
        abort.signal,
      );
      if (result) onReview(result);
    } catch (error) {
      if (error instanceof EngineError) setFailed(true);
      else throw error;
    } finally {
      if (controller.current === abort) setProgress(null);
    }
  }

  const flagged = review?.moves.filter((move) => isError(move.quality)) ?? [];
  const brilliant = review?.moves.filter((move) => move.quality === "brilliant") ?? [];
  const covered = review !== null && review.moves.length === moves.length;

  return (
    <div>
      <h2 className="analysis__heading">Your moves</h2>
      {progress ? (
        <p className="hint" role="status">
          Reviewing move {Math.min(progress.done + 1, progress.total)} of {progress.total}…
        </p>
      ) : (
        <button type="button" disabled={moves.length === 0 || paused} onClick={() => void start()}>
          {review ? "Review again" : "Review moves"}
        </button>
      )}
      {moves.length === 0 && <p className="hint">Play some moves first. A single position has no moves to judge.</p>}
      {failed && (
        <p className="input__problem" role="alert">
          {ENGINE_UNAVAILABLE}
        </p>
      )}
      {review && !progress && (
        <>
          {!covered && <p className="hint">Moves have changed since this review.</p>}
          {brilliant.length > 0 && (
            <ul className="reviewed">
              {brilliant.map((move) => (
                <li key={move.ply}>
                  <span className="reviewed__move reviewed__move--good">
                    {move.san}
                    {QUALITY_MARK.brilliant}
                  </span>{" "}
                  Brilliant: it gives up material and still holds.
                  {move.followUp.length > 0 && moves[move.ply]
                    ? ` The engine expects ${numberMoves(moves[move.ply]!.after, move.followUp)}.`
                    : ""}
                </li>
              ))}
            </ul>
          )}
          {flagged.length === 0 ? (
            <p className="hint">No inaccuracies, mistakes or blunders found.</p>
          ) : (
            <ul className="reviewed">
              {flagged.map((move) => (
                <li key={move.ply}>
                  <span className="reviewed__move">
                    {move.san}
                    {QUALITY_MARK[move.quality!]}
                  </span>{" "}
                  {QUALITY_NAME[move.quality!]}.{move.better ? ` ${move.better} was better.` : ""}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
