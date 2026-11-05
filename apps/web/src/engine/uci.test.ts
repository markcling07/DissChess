import { describe, expect, it } from "vitest";
import { parseBestMove, parseInfo, parseUciMove, toWhiteView } from "./uci";

describe("parseInfo", () => {
  it("reads a full progress line", () => {
    const line =
      "info depth 12 seldepth 18 multipv 2 score cp -34 nodes 1000 nps 5000 hashfull 1 time 20 pv e7e5 g1f3 b8c6";
    expect(parseInfo(line)).toEqual({
      depth: 12,
      multipv: 2,
      score: { kind: "cp", value: -34 },
      pv: ["e7e5", "g1f3", "b8c6"],
    });
  });

  it("reads a mate score", () => {
    expect(parseInfo("info depth 5 score mate -3 pv a1a2")?.score).toEqual({ kind: "mate", value: -3 });
  });

  it("assumes the first line when multipv is absent", () => {
    expect(parseInfo("info depth 1 score cp 10 pv e2e4")?.multipv).toBe(1);
  });

  it.each([
    "info string NNUE evaluation using nn-abc.nnue",
    "info depth 12 currmove e2e4 currmovenumber 1",
    "info depth 12 score cp 10",
    "info depth 12 pv e2e4",
    "info score cp 10 pv e2e4",
    "bestmove e2e4",
    "readyok",
    "",
  ])("ignores %j", (line) => {
    expect(parseInfo(line)).toBeNull();
  });

  it.each(["lowerbound", "upperbound"])("ignores a %s, which isn't an exact score", (bound) => {
    expect(parseInfo(`info depth 12 multipv 1 score cp 50 ${bound} nodes 1 pv e2e4`)).toBeNull();
  });
});

describe("parseBestMove", () => {
  it("reads the move, with or without a ponder move", () => {
    expect(parseBestMove("bestmove e2e4")).toBe("e2e4");
    expect(parseBestMove("bestmove e7e8q ponder a1a2")).toBe("e7e8q");
  });

  it("reports no legal move as null", () => {
    expect(parseBestMove("bestmove (none)")).toBeNull();
  });

  it("is undefined for other lines", () => {
    expect(parseBestMove("info depth 1")).toBeUndefined();
  });
});

describe("toWhiteView", () => {
  it("keeps White's scores and flips Black's", () => {
    expect(toWhiteView({ kind: "cp", value: 30 }, "w")).toEqual({ kind: "cp", value: 30 });
    expect(toWhiteView({ kind: "cp", value: 30 }, "b")).toEqual({ kind: "cp", value: -30 });
    expect(toWhiteView({ kind: "mate", value: 2 }, "b")).toEqual({ kind: "mate", value: -2 });
  });
});

describe("parseUciMove", () => {
  it("handles plain moves and promotions", () => {
    expect(parseUciMove("e2e4")).toEqual({ from: "e2", to: "e4" });
    expect(parseUciMove("a7a8n")).toEqual({ from: "a7", to: "a8", promotion: "n" });
  });
});
