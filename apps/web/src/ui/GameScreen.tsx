import { Chess, type Color, type Square } from "chess.js";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { GameSession, type GameStatus, type PromotionPiece } from "../chess/game";
import { QUALITY_MARK } from "../engine/evaluation";
import type { GameReview } from "../engine/review";
import { ENGINE_UNAVAILABLE, getEngine } from "../engine/sharedEngine";
import { DEFAULT_STRENGTH, STRENGTHS, type Strength } from "../engine/strength";
import { parseUciMove } from "../engine/uci";
import { AnalysisPanel } from "./AnalysisPanel";
import { Board } from "./Board";
import { MoveImages } from "./MoveImages";
import { PromotionDialog } from "./PromotionDialog";
import { Scoresheet } from "./Scoresheet";
import type { PastedMoves } from "./SetupScreen";

const SIDE_NAME: Record<Color, string> = { w: "White", b: "Black" };

const DRAW_REASON = {
  insufficient_material: "Draw: not enough pieces left to checkmate.",
  fifty_moves: "Draw by the fifty-move rule.",
  threefold: "Draw: the same position has occurred three times.",
} as const;

export function statusText(status: GameStatus): string {
  switch (status.kind) {
    case "playing":
      return status.check
        ? `${SIDE_NAME[status.turn]} to move, in check.`
        : `${SIDE_NAME[status.turn]} to move.`;
    case "checkmate":
      return `Checkmate. ${SIDE_NAME[status.winner]} wins.`;
    case "stalemate":
      return `Stalemate. It's a draw.`;
    case "draw":
      return DRAW_REASON[status.reason];
  }
}

function resultMark(status: GameStatus): string | null {
  switch (status.kind) {
    case "playing":
      return null;
    case "checkmate":
      return status.winner === "w" ? "1–0" : "0–1";
    default:
      return "½–½";
  }
}

/** A button that asks for a second tap, for actions that throw away the moves played so far. */
function ConfirmButton({
  label,
  confirmLabel,
  needsConfirm,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  needsConfirm: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      className={armed ? "armed" : undefined}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (needsConfirm && !armed) {
          setArmed(true);
        } else {
          setArmed(false);
          onConfirm();
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

interface Opponent {
  readonly computer: Color;
  readonly strength: Strength;
}

function OpponentChooser({
  initialSide,
  onStart,
  onClose,
}: {
  initialSide: Color;
  onStart: (you: Color, strength: Strength) => void;
  onClose: () => void;
}) {
  const [side, setSide] = useState<Color>(initialSide);
  const [strength, setStrength] = useState<Strength>(DEFAULT_STRENGTH);

  return (
    <section className="chooser" aria-label="Play against computer">
      <fieldset>
        <legend>You play</legend>
        <div className="segmented">
          {(["w", "b"] as const).map((color) => (
            <label key={color} className="segmented__option">
              <input type="radio" name="your-side" checked={side === color} onChange={() => setSide(color)} />
              <span>{SIDE_NAME[color]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field">
        <span>Strength</span>
        <select
          value={strength.id}
          onChange={(event) => setStrength(STRENGTHS.find((s) => s.id === event.target.value) ?? DEFAULT_STRENGTH)}
        >
          {STRENGTHS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button type="button" className="primary" onClick={() => onStart(side, strength)}>
          Start playing
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </section>
  );
}

export function GameScreen({
  startFen,
  pasted,
  onEdit,
}: {
  startFen: string;
  /** The moves that reached startFen, when they were pasted, so they can be reviewed and saved. */
  pasted?: PastedMoves;
  onEdit: () => void;
}) {
  const game = useMemo(
    () => (pasted ? new GameSession(pasted.startFen, pasted.sans) : new GameSession(startFen)),
    [startFen, pasted],
  );
  const [version, refresh] = useReducer((current: number) => current + 1, 0);
  const [orientation, setOrientation] = useState<Color>("w");
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [copied, setCopied] = useState(false);
  const [opponent, setOpponent] = useState<Opponent | null>(null);
  const [choosingOpponent, setChoosingOpponent] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [engineProblem, setEngineProblem] = useState(false);
  const [review, setReview] = useState<GameReview | null>(null);
  const [savingPictures, setSavingPictures] = useState(false);
  const [bestMove, setBestMove] = useState<{ from: Square; to: Square } | null>(null);
  const showBestMove = useCallback((move: { from: Square; to: Square } | null) => setBestMove(move), []);

  const status = game.status();
  const firstMoveNumber = useMemo(() => new Chess(game.startFen).moveNumber(), [game]);
  const fen = game.fen;
  const computerToMove = opponent !== null && status.kind === "playing" && game.turn === opponent.computer;

  useEffect(() => {
    if (!computerToMove || !opponent) return;
    let stale = false;
    const handle = getEngine().search({
      fen,
      movetimeMs: opponent.strength.movetimeMs,
      skill: opponent.strength.skill,
    });
    handle.promise
      .then((result) => {
        if (stale || result.cancelled || !result.bestMove) return;
        const { from, to, promotion } = parseUciMove(result.bestMove);
        game.move(from as Square, to as Square, promotion as PromotionPiece | undefined);
        refresh();
      })
      .catch(() => {
        if (stale) return;
        setEngineProblem(true);
        setOpponent(null);
      });
    return () => {
      stale = true;
      handle.cancel();
    };
    // The version changes with each move, and a new position needs a new search.
  }, [computerToMove, opponent, fen, game, version]);

  // Against the computer, undo also takes back its reply, or it would just play the move again.
  const undoPlies = opponent && game.turn !== opponent.computer ? 2 : 1;
  const plies = game.plies();
  const marks = useMemo(() => {
    const result = new Map<number, string>();
    for (const move of review?.moves ?? []) {
      if (move.quality && plies[move.ply]?.san === move.san) result.set(move.ply, QUALITY_MARK[move.quality]);
    }
    return result;
    // Plies is rebuilt each render, and the moves only differ when the version does.
  }, [review, version]);

  function handleMove(from: Square, to: Square) {
    if (game.isPromotion(from, to)) {
      setPendingPromotion({ from, to });
      return;
    }
    game.move(from, to);
    refresh();
  }

  function choosePromotion(piece: PromotionPiece) {
    if (pendingPromotion) game.move(pendingPromotion.from, pendingPromotion.to, piece);
    setPendingPromotion(null);
  }

  async function copyFen() {
    try {
      await navigator.clipboard.writeText(game.fen);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="layout layout--game">
      <section className="layout__board" aria-label="Board">
        <div className="board-stack">
          <Board
            placement={game.fen.split(" ")[0]!}
            orientation={orientation}
            interaction={{
              kind: "play",
              turn: game.turn,
              destinations: pendingPromotion || computerToMove ? new Map() : game.destinations(),
              lastMove: game.lastMove,
              check: status.kind === "playing" ? status.check : status.kind === "checkmate",
              onMove: handleMove,
            }}
            arrows={analysing && bestMove ? [bestMove] : []}
          />
          {pendingPromotion && (
            <PromotionDialog
              color={game.turn}
              onChoose={choosePromotion}
              onCancel={() => setPendingPromotion(null)}
            />
          )}
        </div>

        <p className={status.kind === "playing" ? "status" : "status status--over"} role="status">
          {computerToMove ? "Computer is thinking…" : statusText(status)}
        </p>

        {engineProblem && (
          <p className="input__problem" role="alert">
            {ENGINE_UNAVAILABLE}
          </p>
        )}

        <div className="actions">
          <button
            type="button"
            disabled={game.moveCount < undoPlies}
            onClick={() => {
              for (let i = 0; i < undoPlies; i += 1) game.undo();
              setPendingPromotion(null);
              refresh();
            }}
          >
            Undo
          </button>
          <ConfirmButton
            label="Restart"
            confirmLabel="Tap again to restart"
            needsConfirm={game.moveCount > 0}
            onConfirm={() => {
              game.restart();
              setPendingPromotion(null);
              setReview(null);
              refresh();
            }}
          />
          <button type="button" onClick={() => setOrientation(orientation === "w" ? "b" : "w")}>
            Flip board
          </button>
          <ConfirmButton
            label="Edit position"
            confirmLabel="Tap again to discard moves"
            needsConfirm={game.moveCount > 0}
            onConfirm={onEdit}
          />
          {opponent ? (
            <button type="button" onClick={() => setOpponent(null)}>
              Switch to two players
            </button>
          ) : (
            <button type="button" onClick={() => setChoosingOpponent(!choosingOpponent)}>
              Play against computer
            </button>
          )}
          <button type="button" onClick={() => setAnalysing(!analysing)}>
            {analysing ? "Hide analysis" : "Analyze position"}
          </button>
          <button type="button" disabled={game.moveCount === 0} onClick={() => setSavingPictures(!savingPictures)}>
            Save moves as pictures
          </button>
        </div>

        {choosingOpponent && !opponent && (
          <OpponentChooser
            initialSide={game.turn}
            onClose={() => setChoosingOpponent(false)}
            onStart={(you, strength) => {
              setOpponent({ computer: you === "w" ? "b" : "w", strength });
              setOrientation(you);
              setChoosingOpponent(false);
              setEngineProblem(false);
            }}
          />
        )}
        {opponent && (
          <p className="hint">
            You're playing {SIDE_NAME[opponent.computer === "w" ? "b" : "w"]} against the computer on{" "}
            {opponent.strength.label} strength.
          </p>
        )}
      </section>

      <section className="layout__side">
        {savingPictures && game.moveCount > 0 && (
          <MoveImages
            moves={plies}
            review={review}
            orientation={orientation}
            onClose={() => setSavingPictures(false)}
          />
        )}
        {analysing && (
          <AnalysisPanel
            fen={fen}
            paused={computerToMove}
            moves={plies}
            review={review}
            onReview={setReview}
            onBestMove={showBestMove}
          />
        )}
        <Scoresheet
          rows={game.scoresheet()}
          result={resultMark(status)}
          firstMoveNumber={firstMoveNumber}
          marks={marks}
        />
        <div className="fen-row">
          <p className="fen">{game.fen}</p>
          <button type="button" onClick={copyFen}>
            {copied ? "Copied" : "Copy FEN"}
          </button>
        </div>
      </section>
    </main>
  );
}
