import { describe, expect, it } from "vitest";
import type { EngineLine } from "./engine";
import {
  describeScore,
  findInsights,
  formatScore,
  judgeMove,
  lineToSan,
  looksBrilliant,
  numberMoves,
  passedFen,
  winPercent,
} from "./evaluation";

const cp = (value: number) => ({ kind: "cp", value }) as const;
const mate = (value: number) => ({ kind: "mate", value }) as const;
const line = (score: EngineLine["score"], pv: string[], multipv = 1): EngineLine => ({
  multipv,
  depth: 10,
  score,
  pv,
});

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("winPercent", () => {
  it("is even at zero and rises with the score", () => {
    expect(winPercent(cp(0))).toBeCloseTo(50);
    expect(winPercent(cp(100))).toBeGreaterThan(50);
    expect(winPercent(cp(1000))).toBeGreaterThan(winPercent(cp(300)));
    expect(winPercent(cp(-100))).toBeLessThan(50);
  });

  it("is symmetrical", () => {
    expect(winPercent(cp(250)) + winPercent(cp(-250))).toBeCloseTo(100);
  });

  it("treats mate as certain", () => {
    expect(winPercent(mate(3))).toBe(100);
    expect(winPercent(mate(-3))).toBe(0);
  });
});

describe("scores in words", () => {
  it.each([
    [cp(34), "+0.34"],
    [cp(-120), "-1.20"],
    [cp(0), "0.00"],
    [mate(3), "White mates in 3"],
    [mate(-2), "Black mates in 2"],
  ])("formats %j", (score, text) => {
    expect(formatScore(score)).toBe(text);
  });

  it.each([
    [cp(10), "About equal"],
    [cp(-20), "About equal"],
    [cp(60), "White is slightly better"],
    [cp(-150), "Black is better"],
    [cp(500), "White is winning"],
    [mate(-4), "Black mates in 4"],
  ])("describes %j", (score, text) => {
    expect(describeScore(score)).toBe(text);
  });
});

describe("lines in chess notation", () => {
  it("converts engine moves, including promotion", () => {
    expect(lineToSan(START, ["e2e4", "e7e5", "g1f3"])).toEqual(["e4", "e5", "Nf3"]);
    expect(lineToSan("8/P6k/8/8/8/8/7K/8 w - - 0 1", ["a7a8q"])).toEqual(["a8=Q"]);
  });

  it("stops at an illegal move instead of failing", () => {
    expect(lineToSan(START, ["e2e4", "e2e4"])).toEqual(["e4"]);
  });

  it("respects the limit", () => {
    expect(lineToSan(START, ["e2e4", "e7e5", "g1f3"], 2)).toEqual(["e4", "e5"]);
  });

  it("numbers moves from the position's own move number", () => {
    expect(numberMoves(START, ["e4", "e5", "Nf3"])).toBe("1. e4 e5 2. Nf3");
    expect(numberMoves("4k3/8/8/8/8/8/4P3/4K3 b - - 0 30", ["Kd8", "e4", "Ke8"])).toBe("30... Kd8 31. e4 Ke8");
  });
});

describe("passedFen", () => {
  it("swaps the side to move and clears en passant", () => {
    expect(passedFen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 3 9")).toBe("4k3/8/8/3pP3/8/8/8/4K3 b - - 3 9");
  });
});

describe("findInsights", () => {
  const SCHOLARS = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";

  it("announces a forced mate for the side to move", () => {
    const [insight] = findInsights(SCHOLARS, [line(mate(1), ["h5f7"])]);
    expect(insight?.kind).toBe("mate");
    expect(insight?.text).toBe("White has checkmate in 1, starting with Qxf7#.");
  });

  it("says when the side to move can't avoid mate", () => {
    const [insight] = findInsights(START, [line(mate(-2), ["f2f3"])]);
    expect(insight?.kind).toBe("being_mated");
    expect(insight?.text).toBe("White can't avoid checkmate in 2. f3 holds out longest.");
  });

  it("uses Black's point of view when Black is to move", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const [winning] = findInsights(fen, [line(mate(-2), ["e7e5"])]);
    expect(winning?.text).toBe("Black has checkmate in 2, starting with e5.");
    const [losing] = findInsights(fen, [line(mate(2), ["e7e5"])]);
    expect(losing?.kind).toBe("being_mated");
  });

  it("points out a move far stronger than the rest", () => {
    const insights = findInsights(START, [line(cp(400), ["e2e4"]), line(cp(0), ["d2d4"], 2)]);
    expect(insights.map((i) => i.kind)).toEqual(["only_move"]);
  });

  it("stays quiet when moves are close", () => {
    expect(findInsights(START, [line(cp(30), ["e2e4", "e7e5"]), line(cp(20), ["d2d4"], 2)])).toEqual([]);
  });

  it("notices a line that wins material after the reply", () => {
    const fen = "4k3/8/8/3q4/8/4N3/8/4K3 w - - 0 1";
    const insights = findInsights(fen, [line(cp(600), ["e3d5", "e8d7"])]);
    expect(insights.map((i) => i.kind)).toContain("wins_material");
  });

  it("doesn't count a capture that gets recaptured", () => {
    const fen = "4k3/2p5/3p4/8/8/8/3Q4/4K3 w - - 0 1";
    const insights = findInsights(fen, [line(cp(100), ["d2d6", "c7d6"])]);
    expect(insights.map((i) => i.kind)).not.toContain("wins_material");
  });

  it("copes with no lines, and with a line that doesn't fit", () => {
    expect(findInsights(START, [])).toEqual([]);
    expect(findInsights(START, [line(cp(0), ["a1a8"])])).toEqual([]);
  });
});

describe("judgeMove", () => {
  it("is quiet for a move that keeps the position", () => {
    expect(judgeMove(cp(30), cp(20), "w")).toBeNull();
  });

  it("grades by how much the mover's winning chances fell", () => {
    expect(judgeMove(cp(0), cp(-60), "w")).toBe("inaccuracy");
    expect(judgeMove(cp(0), cp(-120), "w")).toBe("mistake");
    expect(judgeMove(cp(0), cp(-300), "w")).toBe("blunder");
  });

  it("works from Black's side", () => {
    expect(judgeMove(cp(0), cp(300), "b")).toBe("blunder");
    expect(judgeMove(cp(0), cp(-300), "b")).toBeNull();
  });

  it("calls missing a forced mate a blunder, if it throws the game away", () => {
    expect(judgeMove(mate(2), cp(0), "w")).toBe("blunder");
  });

  it("calls walking into mate a blunder", () => {
    expect(judgeMove(cp(0), mate(-1), "w")).toBe("blunder");
  });

  it("doesn't punish small losses when already far ahead or behind", () => {
    expect(judgeMove(cp(800), cp(600), "w")).toBeNull();
    expect(judgeMove(cp(-800), cp(-1000), "w")).toBeNull();
  });

  it("doesn't punish a move when the game was already lost", () => {
    expect(judgeMove(mate(-3), mate(-2), "w")).toBeNull();
  });
});

describe("spotting brilliant moves", () => {
  // The bishop sacrifice on h7, taken, with the knight check to follow.
  const GREEK_GIFT = "r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 8";
  const TAKEN = ["g8h7", "f3g5", "h7g8"];

  it("calls a sacrifice brilliant when the engine says it still holds", () => {
    expect(looksBrilliant(GREEK_GIFT, "Bxh7+", cp(60), cp(90), TAKEN)).toBe(true);
  });

  it("calls a sacrifice that leads to mate brilliant", () => {
    expect(looksBrilliant(GREEK_GIFT, "Bxh7+", cp(300), mate(7), TAKEN)).toBe(true);
  });

  it("allows the engine's own first choice a little search noise, but not other moves", () => {
    expect(looksBrilliant(GREEK_GIFT, "Bxh7+", cp(130), cp(90), TAKEN, "d3h7")).toBe(true);
    expect(looksBrilliant(GREEK_GIFT, "Bxh7+", cp(130), cp(90), TAKEN, "c1g5")).toBe(false);
  });

  it("doesn't call a sacrifice brilliant when it throws the advantage away", () => {
    expect(looksBrilliant(GREEK_GIFT, "Bxh7+", cp(60), cp(-250), TAKEN)).toBe(false);
  });

  it("doesn't count material won straight back", () => {
    // Bxf6 Nxf6 gives a bishop for a knight: even.
    const fen = "r1bqkb1r/pppp1ppp/2n2n2/4p1B1/4P3/2N5/PPPP1PPP/R2QKBNR w KQkq - 4 4";
    expect(looksBrilliant(fen, "Bxf6", cp(20), cp(20), ["d8f6", "c3d5", "f6d8"])).toBe(false);
  });

  it("doesn't count a sacrifice the other side declines", () => {
    expect(looksBrilliant(GREEK_GIFT, "Bxh7+", cp(60), cp(90), ["g8h8", "f3g5", "g7g6"])).toBe(false);
  });

  it("needs at least one reply to judge", () => {
    expect(looksBrilliant(GREEK_GIFT, "Bxh7+", cp(60), cp(90), [])).toBe(false);
  });
});
