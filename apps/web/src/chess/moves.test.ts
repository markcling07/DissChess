import { describe, expect, it } from "vitest";
import { moveTokens, positionFromMoves } from "./moves";

const GAME = "1. c4 b6 2. b3 c6 3. Bb2 Bb7 4. Nf3 f6 5. d3 e5 6. e4 d6 7. Be2 Nd7 8. Nc3 Ne7 9. O-O g5 10. Nd2 h5 11. Bxh5+ Ng6";
const GAME_FEN = "r2qkb1r/pb1n4/1ppp1pn1/4p1pB/2P1P3/1PNP4/PB1N1PPP/R2Q1RK1 w kq - 1 12";

describe("reading a move list", () => {
  it("plays the moves from the starting position", () => {
    const result = positionFromMoves(GAME);
    expect(result).toMatchObject({ fen: GAME_FEN, played: 22, last: "11... Ng6" });
    expect(result.startFen).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    expect(result.sans).toHaveLength(22);
    expect(result.sans.at(-1)).toBe("Ng6");
  });

  it("reads moves copied as a table, with piece figurines apart from the square", () => {
    const table = `Starting Position
1.\tc4\tb6
2.\tb3\tc6
3.\t♗ b2\t♝ b7
4.\t♘ f3\tf6
5.\td3\te5
6.\te4\td6
7.\t♗ e2\t♞ d7
8.\t♘ c3\t♞ e7
9.\tO-O\tg5
10.\t♘ d2\th5
11.\t♗ xh5+\t♞ g6`;
    expect(positionFromMoves(table).fen).toBe(GAME_FEN);
  });

  it("ignores PGN tags, comments, side lines, annotations and the result", () => {
    const pgn = `[Event "Club night"]
[White "A"]
[Black "B"]

1. e4 {best by test} e5 2. Nf3 (2. f4 exf4 (2... d5)) 2... Nc6!? $1 3. Bb5 a6 1-0`;
    const result = positionFromMoves(pgn);
    expect(result.played).toBe(6);
    expect(result.last).toBe("3... a6");
  });

  it("starts from the FEN tag when a PGN has one", () => {
    const pgn = `[SetUp "1"]
[FEN "4k3/8/8/8/8/8/4R3/4K3 b - - 0 40"]

40... Kd8 41. Re7`;
    const result = positionFromMoves(pgn);
    expect(result.fen).toBe("3k4/4R3/8/8/8/8/8/4K3 b - - 2 41");
    expect(result.last).toBe("41. Re7");
  });

  it("accepts moves without numbers, zeros for castling, and joined numbers", () => {
    expect(positionFromMoves("e4 e5 Nf3 Nc6 Bc4 Bc5 0-0").last).toBe("4. O-O");
    expect(positionFromMoves("1.e4 e5 2.Nf3 2...Nc6").last).toBe("2... Nc6");
  });

  it("names the first move that can't be played", () => {
    expect(() => positionFromMoves("1. e4 e5 2. Nf6")).toThrow("Couldn't play 2. Nf6 for White.");
    expect(() => positionFromMoves("1. e4 Ke2")).toThrow("Couldn't play 1... Ke2 for Black.");
  });

  it("explains empty text and text with no moves", () => {
    expect(() => positionFromMoves("  ")).toThrow("Enter the moves");
    expect(() => positionFromMoves("1-0")).toThrow("No moves were found");
  });

  it("explains a FEN tag it can't play from", () => {
    expect(() => positionFromMoves('[FEN "nonsense"]\n1. e4')).toThrow("The FEN tag");
  });
});

describe("splitting moves", () => {
  it("cleans checks, captures written with ×, and e.p.", () => {
    expect(moveTokens("1. e4+ d5 2. e×d5 e.p. 3. Qh5#!")).toEqual(["e4", "d5", "exd5", "Qh5"]);
  });
});
