/** The position being set up, together with what's still to be checked from a recognised image. */
import type { RecognitionSuccess } from "@photo-to-chess/contract";
import { standardSetup, type PositionSetup } from "../chess/position";
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
}

export type SessionAction =
  | SetupAction
  | { type: "review"; action: ReviewAction }
  | { type: "useRecognition"; result: RecognitionSuccess }
  | { type: "startByHand" };

export function initialSession(): SetupSession {
  return { setup: standardSetup(), review: null };
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
      };
    case "startByHand":
      return initialSession();
    case "clear":
    case "standard":
    case "load":
      // These start from something new, so the image no longer describes the board.
      return { setup: setupReducer(session.setup, action), review: null };
    default: {
      const setup = setupReducer(session.setup, action);
      if (!session.review) return { setup, review: null };
      if (action.type === "rotate") {
        return { setup, review: reviewReducer(session.review, { type: "rotated" }) };
      }
      if (setup.placement !== session.setup.placement) {
        return {
          setup,
          review: reviewReducer(session.review, {
            type: "placementChanged",
            before: session.setup.placement,
            after: setup.placement,
          }),
        };
      }
      return { setup, review: session.review };
    }
  }
}
