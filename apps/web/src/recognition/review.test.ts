import type { RecognitionSuccess } from "@photo-to-chess/contract";
import { describe, expect, it } from "vitest";
import { parsePlacement, STANDARD_PLACEMENT, toPlacementString } from "../chess/position";
import { hasBlockingIssue, validatePosition } from "../chess/validate";
import { initialSession, sessionReducer } from "../setup/sessionState";
import { effectiveSide } from "../setup/setupState";
import { pieceConfidence, reviewFromRecognition, setupFromRecognition, unresolvedCount } from "./review";

function result(placement: string, flagged: string[] = [], orientationReview = false): RecognitionSuccess {
  const board = parsePlacement(placement);
  const squares = [];
  for (const file of "abcdefgh") {
    for (const rank of "12345678") {
      const square = `${file}${rank}`;
      const isFlagged = flagged.includes(square);
      squares.push({
        square,
        label: board.get(square as never) ?? "empty",
        confidence: isFlagged ? 0.6 : 0.99,
        alternatives: isFlagged ? [{ label: "N", probability: 0.3 }] : [],
        needs_review: isFlagged,
        review_reasons: isFlagged ? ["low_confidence"] : [],
      });
    }
  }
  return {
    contract_version: "1.0",
    status: "ok",
    source_kind: "screenshot",
    board: {
      corners: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      confidence: 1,
    },
    orientation: { quarter_turns_cw: 0, confidence: 0.99, method: "piece_layout", needs_review: orientationReview },
    placement,
    squares,
    issues: [],
    rectified_preview: null,
    engine: { name: "test", version: "0" },
    timings_ms: {},
  } as unknown as RecognitionSuccess;
}

const MIDGAME = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R";

describe("setupFromRecognition", () => {
  it("doesn't invent details the image can't show", () => {
    const setup = setupFromRecognition(result(MIDGAME));
    expect(setup.sideToMove).toBeNull();
    expect(setup.enPassant).toBeNull();
    expect(toPlacementString(setup.placement)).toBe(MIDGAME);
    expect(hasBlockingIssue(validatePosition(setup))).toBe(true);
  });

  it("prefills castling wherever king and rook are still on their home squares", () => {
    const setup = setupFromRecognition(result("r1bqkb1r/ppp2ppp/2n2n2/3Pp1N1/2B5/8/PPPP1PPP/RNB1K3"));
    expect(setup.castling).toEqual({ K: false, Q: true, k: true, q: true });
  });

  it("prefills castling for the starting position, and still asks whose turn it is", () => {
    const setup = setupFromRecognition(result(STANDARD_PLACEMENT));
    expect(setup.castling).toEqual({ K: true, Q: true, k: true, q: true });
    expect(setup.sideToMove).toBeNull();
    expect(effectiveSide(setup)).toBeNull();
  });
});

describe("review", () => {
  function session(flagged: string[], orientationReview = false) {
    return sessionReducer(initialSession(), {
      type: "useRecognition",
      result: result(MIDGAME, flagged, orientationReview),
    });
  }

  it("counts squares and orientation as unresolved", () => {
    expect(unresolvedCount(null)).toBe(0);
    expect(unresolvedCount(session([]).review)).toBe(0);
    expect(unresolvedCount(session(["c6", "f3"]).review)).toBe(2);
    expect(unresolvedCount(session(["c6"], true).review)).toBe(2);
  });

  it("confirming resolves a flag and leaves the piece as it was", () => {
    const after = sessionReducer(session(["c6", "f3"]), {
      type: "review",
      action: { type: "confirmSquare", square: "c6" },
    });
    expect([...after.review!.flagged.keys()]).toEqual(["f3"]);
    expect(after.setup.placement.get("c6")).toBe("n");
  });

  it("changing a flagged square resolves it, whichever way it was changed", () => {
    const placed = sessionReducer(session(["c6"]), { type: "place", square: "c6", piece: "b" });
    expect(placed.review!.flagged.size).toBe(0);
    const removed = sessionReducer(session(["c6"]), { type: "remove", square: "c6" });
    expect(removed.review!.flagged.size).toBe(0);
  });

  it("changing another square leaves the flag in place", () => {
    const after = sessionReducer(session(["c6"]), { type: "place", square: "a4", piece: "P" });
    expect([...after.review!.flagged.keys()]).toEqual(["c6"]);
  });

  it("drops the reading of a changed square from the confidence figures", () => {
    const before = session(["c6"]);
    expect(pieceConfidence(before.review!)).toEqual({ pieces: 32, lowest: 0.6 });
    const after = sessionReducer(before, { type: "place", square: "c6", piece: "b" });
    expect(pieceConfidence(after.review!)?.lowest).toBe(0.99);
  });

  it("flags follow the pieces when the board is rotated", () => {
    let current = session(["a1"]);
    current = sessionReducer(current, { type: "rotate" });
    expect([...current.review!.flagged.keys()]).toEqual(["a8"]);
    expect(current.review!.quarterTurns).toBe(1);
    current = sessionReducer(current, { type: "rotate" });
    expect([...current.review!.flagged.keys()]).toEqual(["h8"]);
    expect(current.review!.quarterTurns).toBe(2);
  });

  it("confirm all clears squares and orientation together", () => {
    const after = sessionReducer(session(["c6", "f3"], true), {
      type: "review",
      action: { type: "confirmAll" },
    });
    expect(unresolvedCount(after.review)).toBe(0);
  });

  it("starting over on the board drops the image's review", () => {
    expect(sessionReducer(session(["c6"]), { type: "clear" }).review).toBeNull();
    expect(sessionReducer(session(["c6"]), { type: "standard" }).review).toBeNull();
  });

  it("keeps the preview from the service", () => {
    const review = reviewFromRecognition({ ...result(MIDGAME), rectified_preview: "data:image/jpeg;base64,AA" });
    expect(review.preview).toBe("data:image/jpeg;base64,AA");
  });
});
