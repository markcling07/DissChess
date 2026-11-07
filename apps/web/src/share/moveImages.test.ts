import { describe, expect, it } from "vitest";
import { GameSession } from "../chess/game";
import type { GameReview, MoveReview } from "../engine/review";
import { buildFrames, defaultClipStart, fileName } from "./moveImages";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const MOVES = new GameSession(START, ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nd4", "Nxe5", "Qg5"]).plies();

function reviewed(ply: number, overrides: Partial<MoveReview> = {}): MoveReview {
  const move = MOVES[ply]!;
  return { ply, san: move.san, color: move.color, quality: null, better: null, followUp: [], ...overrides };
}

function reviewOf(...overrides: [number, Partial<MoveReview>][]): GameReview {
  const moves = MOVES.map((_, ply) => reviewed(ply));
  for (const [ply, change] of overrides) moves[ply] = reviewed(ply, change);
  return { moves };
}

describe("choosing moves to save as pictures", () => {
  it("numbers each move and keeps where it went", () => {
    const frames = buildFrames(MOVES, null, 2, 3);
    expect(frames.map((frame) => frame.label)).toEqual(["2. Nf3", "2... Nc6", "3. Bc4"]);
    expect(frames[0]).toMatchObject({ ply: 2, from: "g1", to: "f3", quality: null, note: null });
  });

  it("stops at the last move", () => {
    expect(buildFrames(MOVES, null, 6, 5)).toHaveLength(2);
  });

  it("adds review marks and what the review said", () => {
    const review = reviewOf(
      [6, { quality: "blunder", better: "Nxd4" }],
      [7, { quality: "brilliant", followUp: ["Nxf7", "Qxg2"] }],
    );
    const [blunder, brilliant] = buildFrames(MOVES, review, 6, 2);
    expect(blunder).toMatchObject({ quality: "blunder", note: "Nxd4 was better." });
    expect(brilliant).toMatchObject({ quality: "brilliant", note: "Engine line: 5. Nxf7 Qxg2" });
  });

  it("leaves out marks from a review of different moves", () => {
    const review = reviewOf([6, { quality: "blunder", san: "d4" }]);
    expect(buildFrames(MOVES, review, 6, 1)[0]?.quality).toBeNull();
  });

  it("starts two moves before the first brilliant move, or at the end", () => {
    expect(defaultClipStart(MOVES, reviewOf([5, { quality: "brilliant" }]), 5)).toBe(3);
    expect(defaultClipStart(MOVES, reviewOf([1, { quality: "brilliant" }]), 5)).toBe(0);
    expect(defaultClipStart(MOVES, null, 5)).toBe(3);
    expect(defaultClipStart(MOVES.slice(0, 2), null, 5)).toBe(0);
  });

  it("names files in order, safe for any phone", () => {
    const [white, black] = buildFrames(MOVES, null, 6, 2);
    expect(fileName(white!, 0)).toBe("photo-to-chess-01-move-4-Nxe5.png");
    expect(fileName(black!, 1)).toBe("photo-to-chess-02-move-4-Qg5.png");
  });
});
