/** The position being set up, together with what's still to be checked from a recognised image. */
import type { Color } from "chess.js";
import type { RecognitionSuccess } from "@photo-to-chess/contract";
import { emptySetup, standardSetup, type PositionSetup } from "../chess/position";
import {
  reviewFromRecognition,
  reviewReducer,
  setupFromRecognition,
  type ReviewAction,
  type ReviewState,
} from "../recognition/review";
import { setupReducer, type SetupAction } from "./setupState";

export interface SetupSession {
  readonly setup: PositionSetup;
  readonly review: ReviewState | null;
  readonly orientation: Color;
}

export type SessionAction =
  | SetupAction
  | { type: "review"; action: ReviewAction }
  | { type: "useRecognition"; result: RecognitionSuccess }
  | { type: "startByHand" }
  | { type: "flipOrientation" };

export function initialSession(): SetupSession {
  return { setup: standardSetup(), review: null, orientation: "w" };
}

export function sessionReducer(session: SetupSession, action: SessionAction): SetupSession {
  switch (action.type) {
    case "review":
      return session.review
        ? { ...session, review: reviewReducer(session.review, action.action) }
        : session;
    case "useRecognition":
      return {
        setup: setupFromRecognition(action.result),
        review: reviewFromRecognition(action.result),
        orientation: action.result.orientation.quarter_turns_cw === 2 ? "b" : "w",
      };
    case "startByHand":
      return { setup: emptySetup(), review: null, orientation: "w" };
    case "flipOrientation":
      return { ...session, orientation: session.orientation === "w" ? "b" : "w" };
    case "clear":
    case "standard":
    case "load":
      return { setup: setupReducer(session.setup, action), review: null, orientation: session.orientation };
    default: {
      const setup = setupReducer(session.setup, action);
      if (!session.review) return { setup, review: null, orientation: session.orientation };
      if (action.type === "rotate") {
        return { setup, review: reviewReducer(session.review, { type: "rotated" }), orientation: session.orientation };
      }
      if (setup.placement !== session.setup.placement) {
        return {
          setup,
          review: reviewReducer(session.review, {
            type: "placementChanged",
            before: session.setup.placement,
            after: setup.placement,
          }),
          orientation: session.orientation,
        };
      }
      return { setup, review: session.review, orientation: session.orientation };
    }
  }
}
