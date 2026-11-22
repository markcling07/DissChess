import type { Square } from "chess.js";
import { useEffect, useState } from "react";
import type { Engine } from "./engine";
import { parseUciMove } from "./uci";

const PREDICTION_DEPTH = 12;
const PREDICTION_MOVETIME_MS = 800;
const PREDICTION_LINES = 2;

export interface PredictionArrow {
  readonly from: Square;
  readonly to: Square;
  readonly rank: number;
}

export interface PredictionState {
  readonly status: "idle" | "running" | "done";
  readonly arrows: readonly PredictionArrow[];
}

const IDLE: PredictionState = { status: "idle", arrows: [] };

/** Runs a quick engine search after each position change, returning the top predicted moves. */
export function usePrediction(engine: Engine | null, fen: string, enabled: boolean): PredictionState {
  const [state, setState] = useState<PredictionState>(IDLE);

  useEffect(() => {
    if (!engine || !enabled) {
      setState(IDLE);
      return;
    }

    let stale = false;
    setState({ status: "running", arrows: [] });

    const handle = engine.search(
      { fen, multipv: PREDICTION_LINES, depth: PREDICTION_DEPTH, movetimeMs: PREDICTION_MOVETIME_MS },
      (lines) => {
        if (stale) return;
        const arrows: PredictionArrow[] = [];
        for (const line of lines) {
          if (line.pv[0]) {
            const { from, to } = parseUciMove(line.pv[0]);
            arrows.push({ from: from as Square, to: to as Square, rank: line.multipv });
          }
        }
        setState({ status: "running", arrows });
      },
    );

    handle.promise
      .then((result) => {
        if (stale || result.cancelled) return;
        const arrows: PredictionArrow[] = [];
        for (const line of result.lines) {
          if (line.pv[0]) {
            const { from, to } = parseUciMove(line.pv[0]);
            arrows.push({ from: from as Square, to: to as Square, rank: line.multipv });
          }
        }
        setState({ status: "done", arrows });
      })
      .catch(() => {
        if (!stale) setState(IDLE);
      });

    return () => {
      stale = true;
      handle.cancel();
    };
  }, [engine, fen, enabled]);

  return state;
}
