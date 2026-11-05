/**
 * What still needs a person's eye after an image is read. Every flag has to be resolved, by fixing
 * the square or confirming it, before play can start. That's what stops a doubtful reading from
 * quietly becoming a game.
 */
import type { RecognitionSuccess } from "@photo-to-chess/contract";
import type { Square } from "chess.js";
import {
  ALL_CASTLING,
  NO_CASTLING,
  parsePlacement,
  STANDARD_PLACEMENT,
  type PieceCode,
  type Placement,
  type PositionSetup,
} from "../chess/position";

const FILES = "abcdefgh";

export interface SquareReading {
  readonly label: string;
  readonly confidence: number;
  readonly alternatives: readonly { readonly label: string; readonly probability: number }[];
}

export interface ReviewState {
  /** The corrected board image from the service, for comparing against the position. */
  readonly preview: string | null;
  /** Clockwise quarter turns applied to the pieces since reading, so the preview can match. */
  readonly quarterTurns: number;
  /** Squares still to be checked. */
  readonly flagged: ReadonlyMap<Square, SquareReading>;
  /** Every square's reading, for the confidence list. Squares the user has changed are removed. */
  readonly readings: ReadonlyMap<Square, SquareReading>;
  readonly orientationUnconfirmed: boolean;
}

export type ReviewAction =
  | { type: "confirmSquare"; square: Square }
  | { type: "confirmAll" }
  | { type: "confirmOrientation" }
  | { type: "placementChanged"; before: Placement; after: Placement }
  | { type: "rotated" };

export function setupFromRecognition(result: RecognitionSuccess): PositionSetup {
  const placement = parsePlacement(result.placement);
  return {
    placement,
    sideToMove: null,
    // The exact starting position is the one case where the pieces settle these rights.
    castling: result.placement === STANDARD_PLACEMENT ? ALL_CASTLING : NO_CASTLING,
    enPassant: null,
    halfmove: 0,
    fullmove: 1,
  };
}

export function reviewFromRecognition(result: RecognitionSuccess): ReviewState {
  const readings = new Map<Square, SquareReading>();
  const flagged = new Map<Square, SquareReading>();
  for (const square of result.squares) {
    const reading: SquareReading = {
      label: square.label,
      confidence: square.confidence,
      alternatives: square.alternatives,
    };
    readings.set(square.square as Square, reading);
    if (square.needs_review) flagged.set(square.square as Square, reading);
  }
  return {
    preview: result.rectified_preview,
    quarterTurns: 0,
    flagged,
    readings,
    orientationUnconfirmed: result.orientation.needs_review,
  };
}

function rotateSquare(square: Square): Square {
  const file = FILES.indexOf(square[0]!);
  const rank = Number(square[1]) - 1;
  return `${FILES[rank]}${8 - file}` as Square;
}

function rotateKeys<T>(map: ReadonlyMap<Square, T>): Map<Square, T> {
  return new Map([...map].map(([square, value]) => [rotateSquare(square), value]));
}

export function reviewReducer(review: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case "confirmSquare": {
      const flagged = new Map(review.flagged);
      flagged.delete(action.square);
      return { ...review, flagged };
    }
    case "confirmAll":
      return { ...review, flagged: new Map(), orientationUnconfirmed: false };
    case "confirmOrientation":
      return { ...review, orientationUnconfirmed: false };
    case "placementChanged": {
      // Once someone has changed a square, there's nothing left for them to check there.
      const flagged = new Map(review.flagged);
      const readings = new Map(review.readings);
      for (const square of readings.keys()) {
        if (action.before.get(square) !== action.after.get(square)) {
          flagged.delete(square);
          readings.delete(square);
        }
      }
      return { ...review, flagged, readings };
    }
    case "rotated":
      return {
        ...review,
        quarterTurns: (review.quarterTurns + 1) % 4,
        flagged: rotateKeys(review.flagged),
        readings: rotateKeys(review.readings),
      };
  }
}

export function unresolvedCount(review: ReviewState | null): number {
  if (!review) return 0;
  return review.flagged.size + (review.orientationUnconfirmed ? 1 : 0);
}

/** A readable summary of how sure the reading was about the pieces it found. */
export function pieceConfidence(review: ReviewState): { pieces: number; lowest: number } | null {
  const confidences = [...review.readings.values()]
    .filter((reading) => reading.label !== "empty")
    .map((reading) => reading.confidence);
  if (!confidences.length) return null;
  return { pieces: confidences.length, lowest: Math.min(...confidences) };
}

export function labelToPiece(label: string): PieceCode | null {
  return label === "empty" ? null : (label as PieceCode);
}
