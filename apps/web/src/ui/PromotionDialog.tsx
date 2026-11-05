import type { Color } from "chess.js";
import { useEffect, useRef } from "react";
import type { PromotionPiece } from "../chess/game";
import type { PieceCode } from "../chess/position";
import { PIECE_INFO, PieceImage } from "./pieces";

const CHOICES: readonly PromotionPiece[] = ["q", "r", "b", "n"];

export function PromotionDialog({
  color,
  onChoose,
  onCancel,
}: {
  color: Color;
  onChoose: (piece: PromotionPiece) => void;
  onCancel: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="promotion" role="dialog" aria-modal="true" aria-label="Choose a promotion piece">
      <div className="promotion__card">
        <p>Promote to</p>
        <div className="promotion__choices">
          {CHOICES.map((choice, index) => {
            const code = (color === "w" ? choice.toUpperCase() : choice) as PieceCode;
            return (
              <button
                key={choice}
                type="button"
                ref={index === 0 ? first : undefined}
                className="tool"
                aria-label={PIECE_INFO[code].name}
                onClick={() => onChoose(choice)}
              >
                <PieceImage piece={code} />
              </button>
            );
          })}
        </div>
        <button type="button" onClick={onCancel}>
          Cancel move
        </button>
      </div>
    </div>
  );
}
