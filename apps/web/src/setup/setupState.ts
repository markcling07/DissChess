/** State of the position being set up. Every change keeps the details consistent with the board. */
import type { Color, Square } from "chess.js";
import {
  CASTLING_RIGHTS,
  canHoldCastlingRight,
  emptySetup,
  enPassantOptions,
  rotatePlacement,
  standardSetup,
  type CastlingRight,
  type PieceCode,
  type Placement,
  type PositionSetup,
} from "../chess/position";
import { forcedSideToMove } from "../chess/validate";

export type SetupAction =
  | { type: "place"; square: Square; piece: PieceCode }
  | { type: "remove"; square: Square }
  | { type: "setPlacement"; placement: Placement }
  | { type: "rotate" }
  | { type: "clear" }
  | { type: "standard" }
  | { type: "setSide"; side: Color }
  | { type: "setCastling"; right: CastlingRight; value: boolean }
  | { type: "setEnPassant"; square: Square | null }
  | { type: "setHalfmove"; value: number }
  | { type: "setFullmove"; value: number }
  | { type: "load"; setup: PositionSetup };

/** The side that's really to move: a king in check settles it, otherwise it's the user's choice. */
export function effectiveSide(setup: PositionSetup): Color | null {
  return forcedSideToMove(setup.placement) ?? setup.sideToMove;
}

/** The setup with the settled side filled in, ready to validate or turn into a FEN. */
export function resolveSetup(setup: PositionSetup): PositionSetup {
  return { ...setup, sideToMove: effectiveSide(setup) };
}

/** Removes castling rights and en passant squares that no longer fit the board. */
export function normaliseSetup(setup: PositionSetup): PositionSetup {
  const castling = { ...setup.castling };
  for (const right of CASTLING_RIGHTS) {
    if (castling[right] && !canHoldCastlingRight(setup.placement, right)) castling[right] = false;
  }
  const side = effectiveSide(setup);
  const enPassant =
    setup.enPassant && side && enPassantOptions(setup.placement, side).includes(setup.enPassant)
      ? setup.enPassant
      : null;
  return { ...setup, castling, enPassant };
}

export function setupReducer(setup: PositionSetup, action: SetupAction): PositionSetup {
  switch (action.type) {
    case "place": {
      const placement = new Map(setup.placement);
      placement.set(action.square, action.piece);
      return normaliseSetup({ ...setup, placement });
    }
    case "remove": {
      const placement = new Map(setup.placement);
      placement.delete(action.square);
      return normaliseSetup({ ...setup, placement });
    }
    case "setPlacement":
      return normaliseSetup({ ...setup, placement: action.placement });
    case "rotate":
      return normaliseSetup({ ...setup, placement: rotatePlacement(setup.placement) });
    case "clear":
      return emptySetup();
    case "standard":
      return standardSetup();
    case "setSide":
      return normaliseSetup({ ...setup, sideToMove: action.side });
    case "setCastling":
      return normaliseSetup({
        ...setup,
        castling: { ...setup.castling, [action.right]: action.value },
      });
    case "setEnPassant":
      return normaliseSetup({ ...setup, enPassant: action.square });
    case "setHalfmove":
      return { ...setup, halfmove: action.value };
    case "setFullmove":
      return { ...setup, fullmove: action.value };
    case "load":
      return normaliseSetup(action.setup);
  }
}
