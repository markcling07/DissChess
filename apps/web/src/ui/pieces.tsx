import type { PieceCode } from "../chess/position";

export const PIECE_INFO: Record<PieceCode, { role: string; color: "white" | "black"; name: string }> = {
  P: { role: "pawn", color: "white", name: "White pawn" },
  N: { role: "knight", color: "white", name: "White knight" },
  B: { role: "bishop", color: "white", name: "White bishop" },
  R: { role: "rook", color: "white", name: "White rook" },
  Q: { role: "queen", color: "white", name: "White queen" },
  K: { role: "king", color: "white", name: "White king" },
  p: { role: "pawn", color: "black", name: "Black pawn" },
  n: { role: "knight", color: "black", name: "Black knight" },
  b: { role: "bishop", color: "black", name: "Black bishop" },
  r: { role: "rook", color: "black", name: "Black rook" },
  q: { role: "queen", color: "black", name: "Black queen" },
  k: { role: "king", color: "black", name: "Black king" },
};

const CODE_BY_ROLE: Record<string, string> = {
  pawn: "p",
  knight: "n",
  bishop: "b",
  rook: "r",
  queen: "q",
  king: "k",
};

export function pieceCodeOf(role: string, color: string): PieceCode {
  const code = CODE_BY_ROLE[role];
  if (!code) throw new Error(`Unknown piece: ${role}`);
  return (color === "white" ? code.toUpperCase() : code) as PieceCode;
}

/**
 * A piece drawn with the same artwork as the board. The artwork's CSS only targets a <piece> tag,
 * which React warns about, so it's written as HTML. The values come from the fixed table above.
 */
export function PieceImage({ piece }: { piece: PieceCode }) {
  const { role, color } = PIECE_INFO[piece];
  return (
    <span
      className="cg-wrap piece-image"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: `<piece class="${role} ${color}"></piece>` }}
    />
  );
}
