import { Chess } from "chess.js";
import { useEffect, useState } from "react";
import type { Engine, EngineLine } from "./engine";
import { lineToSan, passedFen, winPercent } from "./evaluation";
import { parseUciMove } from "./uci";

const ANALYSIS_LINES = 3;
const ANALYSIS_DEPTH = 18;
const ANALYSIS_MOVETIME_MS = 4000;
const THREAT_DEPTH = 12;
const THREAT_MOVETIME_MS = 800;
const THREAT_GAIN = 15;

export interface Threat {
  readonly text: string;
}

export interface AnalysisState {
  readonly status: "idle" | "running" | "done" | "failed";
  readonly fen: string | null;
  readonly lines: readonly EngineLine[];
  readonly threat: Threat | null;
}

const IDLE: AnalysisState = { status: "idle", fen: null, lines: [], threat: null };

function describeThreat(fen: string, line: EngineLine | undefined, current: EngineLine | undefined): Threat | null {
  if (!line?.pv.length) return null;
  const chess = new Chess(fen);
  const mover = chess.turn() === "w" ? "White" : "Black";
  const opponent = mover === "White" ? "Black" : "White";
  const passed = passedFen(fen);
  const san = lineToSan(passed, line.pv, 1)[0];
  if (!san) return null;

  const direction = opponent === "White" ? 1 : -1;
  if (line.score.kind === "mate" && line.score.value * direction > 0) {
    return { text: `${opponent} threatens checkmate in ${Math.abs(line.score.value)}, starting with ${san}.` };
  }
  if (!current) return null;
  const gain = direction * (winPercent(line.score) - winPercent(current.score));
  const move = parseUciMove(line.pv[0]!);
  const opponentBoard = new Chess(passed);
  const isCapture = Boolean(opponentBoard.get(move.to as never));
  if (gain >= THREAT_GAIN && isCapture) return { text: `${opponent} threatens ${san}.` };
  return null;
}

/** Analyses the position continuously while enabled, starting again whenever it changes. */
export function useAnalysis(engine: Engine | null, fen: string, enabled: boolean): AnalysisState {
  const [state, setState] = useState<AnalysisState>(IDLE);

  useEffect(() => {
    if (!engine || !enabled) {
      setState(IDLE);
      return;
    }
    const chess = new Chess(fen);
    if (chess.isGameOver()) {
      setState({ status: "done", fen, lines: [], threat: null });
      return;
    }

    let stale = false;
    let active: { cancel(): void } | null = null;
    setState({ status: "running", fen, lines: [], threat: null });

    async function run() {
      const main = engine!.search(
        { fen, multipv: ANALYSIS_LINES, depth: ANALYSIS_DEPTH, movetimeMs: ANALYSIS_MOVETIME_MS },
        (lines) => {
          if (!stale) setState((previous) => ({ ...previous, lines }));
        },
      );
      active = main;
      const result = await main.promise;
      if (stale) return;
      setState((previous) => ({ ...previous, lines: result.lines }));

      // A threat means what the other side would do given a free move. That can't be asked of a
      // side in check, since passing there would leave its king capturable.
      let threat: Threat | null = null;
      if (!chess.isCheck()) {
        const passed = engine!.search({
          fen: passedFen(fen),
          multipv: 1,
          depth: THREAT_DEPTH,
          movetimeMs: THREAT_MOVETIME_MS,
        });
        active = passed;
        const threatResult = await passed.promise;
        if (stale) return;
        threat = describeThreat(fen, threatResult.lines[0], result.lines[0]);
      }
      setState({ status: "done", fen, lines: result.lines, threat });
    }

    run().catch(() => {
      if (!stale) setState({ status: "failed", fen, lines: [], threat: null });
    });

    return () => {
      stale = true;
      active?.cancel();
    };
  }, [engine, fen, enabled]);

  return state;
}
