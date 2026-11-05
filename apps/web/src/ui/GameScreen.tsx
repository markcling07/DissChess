import { Chess, type Color, type Square } from "chess.js";
import { useEffect, useMemo, useReducer, useState } from "react";
import { GameSession, type GameStatus, type PromotionPiece } from "../chess/game";
import { Board } from "./Board";
import { PromotionDialog } from "./PromotionDialog";
import { Scoresheet } from "./Scoresheet";

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

export function GameScreen({ startFen, onEdit }: { startFen: string; onEdit: () => void }) {
  const game = useMemo(() => new GameSession(startFen), [startFen]);
  const [, refresh] = useReducer((version: number) => version + 1, 0);
  const [orientation, setOrientation] = useState<Color>("w");
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [copied, setCopied] = useState(false);

  const status = game.status();
  const firstMoveNumber = useMemo(() => new Chess(startFen).moveNumber(), [startFen]);

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
              destinations: pendingPromotion ? new Map() : game.destinations(),
              lastMove: game.lastMove,
              check: status.kind === "playing" ? status.check : status.kind === "checkmate",
              onMove: handleMove,
            }}
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
          {statusText(status)}
        </p>

        <div className="actions">
          <button
            type="button"
            disabled={game.moveCount === 0}
            onClick={() => {
              game.undo();
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
        </div>
      </section>

      <section className="layout__side">
        <Scoresheet rows={game.scoresheet()} result={resultMark(status)} firstMoveNumber={firstMoveNumber} />
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
