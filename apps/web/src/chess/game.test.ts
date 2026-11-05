import { Chess, type Square } from "chess.js";
import { describe, expect, it } from "vitest";
import { GameSession, type PromotionPiece } from "./game";
import crosscheck from "./rules-crosscheck.json";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function play(game: GameSession, ...moves: string[]): void {
  for (const move of moves) {
    const from = move.slice(0, 2) as Square;
    const to = move.slice(2, 4) as Square;
    const promotion = move[4] as PromotionPiece | undefined;
    expect(game.move(from, to, promotion), `move ${move}`).toBe(true);
  }
}

function perft(chess: Chess, depth: number): number {
  if (depth === 0) return 1;
  let nodes = 0;
  for (const move of chess.moves({ verbose: true })) {
    chess.move(move);
    nodes += perft(chess, depth - 1);
    chess.undo();
  }
  return nodes;
}

describe("move generation matches published perft counts", () => {
  it.each([
    ["start", START, [20, 400, 8902]],
    ["kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", [48, 2039]],
    ["position 3", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", [14, 191, 2812]],
    ["position 4", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", [6, 264, 9467]],
    ["position 5", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", [44, 1486]],
    ["position 6", "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10", [46, 2079]],
  ] as const)("%s", (_name, fen, counts) => {
    counts.forEach((count, index) => {
      expect(perft(new Chess(fen), index + 1)).toBe(count);
    });
  });
});

describe("cross-check with python-chess", () => {
  it("covers positions that end the game", () => {
    expect(crosscheck.rules.length).toBeGreaterThan(200);
    expect(crosscheck.rules.some((c) => c.checkmate)).toBe(true);
    expect(crosscheck.rules.some((c) => c.legal.some((m) => m.length === 5))).toBe(true);
  });

  it("agrees on every legal move, check, checkmate and stalemate", () => {
    for (const { fen, legal, check, checkmate, stalemate } of crosscheck.rules) {
      const chess = new Chess(fen);
      const moves = chess.moves({ verbose: true }).map((m) => m.lan).sort();
      expect(moves, fen).toEqual([...legal].sort());
      expect(chess.isCheck(), fen).toBe(check);
      expect(chess.isCheckmate(), fen).toBe(checkmate);
      expect(chess.isStalemate(), fen).toBe(stalemate);
    }
  });
});

describe("starting from a position", () => {
  it("keeps every piece exactly where the FEN put it", () => {
    const fen = "r1bq1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1 b - - 7 11";
    expect(new GameSession(fen).fen).toBe(fen);
  });

  it("gives Black the first move when the position says so", () => {
    const game = new GameSession("4k3/8/8/8/8/8/4P3/4K3 b - - 0 1");
    expect(game.turn).toBe("b");
    expect(game.destinations().has("e8")).toBe(true);
    expect(game.destinations().has("e1")).toBe(false);
  });

  it("rejects a FEN that chess.js can't load", () => {
    expect(() => new GameSession("8/8/8/8/8/8/8/8 w - - 0 1")).toThrow();
  });
});

describe("illegal moves", () => {
  it("are refused and change nothing", () => {
    const game = new GameSession(START);
    expect(game.move("e2", "e5")).toBe(false);
    expect(game.move("e7", "e5")).toBe(false);
    expect(game.fen).toBe(START);
    expect(game.moveCount).toBe(0);
  });

  it("include moving a pinned piece", () => {
    const game = new GameSession("4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1");
    expect(game.destinations().has("e2")).toBe(false);
    expect(game.move("e2", "d3")).toBe(false);
  });

  it("include ignoring check", () => {
    const game = new GameSession("4k3/8/8/8/8/8/4r2P/4K3 w - - 0 1");
    expect(game.move("h2", "h3")).toBe(false);
  });
});

describe("castling", () => {
  const FEN = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";

  it("works on both sides for both colours", () => {
    const game = new GameSession(FEN);
    play(game, "e1g1", "e8c8");
    expect(game.fen).toBe("2kr3r/8/8/8/8/8/8/R4RK1 w - - 2 2");
  });

  it("isn't offered without the right", () => {
    const game = new GameSession("r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1");
    expect(game.destinations().get("e1")).not.toContain("g1");
    expect(game.destinations().get("e1")).not.toContain("c1");
  });

  it("is refused through an attacked square", () => {
    const game = new GameSession("4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1");
    expect(game.destinations().get("e1")).not.toContain("g1");
  });

  it("is lost after the rook moves", () => {
    const game = new GameSession(FEN);
    play(game, "h1h2", "e8e7", "h2h1", "e7e8");
    expect(game.destinations().get("e1")).not.toContain("g1");
    expect(game.destinations().get("e1")).toContain("c1");
  });
});

describe("en passant", () => {
  it("captures the pawn when the FEN allows it", () => {
    const game = new GameSession("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2");
    play(game, "e5d6");
    expect(game.fen.split(" ")[0]).toBe("4k3/8/3P4/8/8/8/8/4K3");
  });

  it("isn't offered unless the FEN allows it", () => {
    const game = new GameSession("4k3/8/8/3pP3/8/8/8/4K3 w - - 0 2");
    expect(game.destinations().get("e5")).toEqual(["e6"]);
  });

  it("is available straight after a two-square push and not later", () => {
    const game = new GameSession("4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1");
    play(game, "d7d5");
    expect(game.destinations().get("e5")).toContain("d6");
    play(game, "e1e2", "e8e7");
    expect(game.destinations().get("e5")).not.toContain("d6");
  });

  it("is refused when it exposes the king", () => {
    const game = new GameSession("8/8/8/K2pP2r/8/8/8/4k3 w - d6 0 2");
    expect(game.destinations().get("e5")).not.toContain("d6");
  });
});

describe("promotion", () => {
  const FEN = "8/P6k/8/8/8/8/7K/8 w - - 0 1";

  it("is recognised before the piece is chosen", () => {
    const game = new GameSession(FEN);
    expect(game.isPromotion("a7", "a8")).toBe(true);
    expect(game.isPromotion("h2", "h3")).toBe(false);
  });

  it.each(["q", "r", "b", "n"] as const)("can become %s", (piece) => {
    const game = new GameSession(FEN);
    play(game, `a7a8${piece}`);
    const expected = piece.toUpperCase();
    expect(game.fen.split(" ")[0]).toBe(`${expected}7/7k/8/8/8/8/7K/8`);
  });

  it("works for Black and by capture", () => {
    const game = new GameSession("7k/8/8/8/8/8/1p6/R3K3 b - - 0 1");
    expect(game.isPromotion("b2", "a1")).toBe(true);
    play(game, "b2a1q");
    expect(game.fen.split(" ")[0]).toBe("7k/8/8/8/8/8/8/q3K3");
  });
});

describe("game endings", () => {
  it("detects checkmate and ends the game", () => {
    const game = new GameSession(START);
    play(game, "f2f3", "e7e5", "g2g4", "d8h4");
    expect(game.status()).toEqual({ kind: "checkmate", winner: "b" });
    expect(game.isOver).toBe(true);
    expect(game.destinations().size).toBe(0);
    expect(game.move("a2", "a3")).toBe(false);
  });

  it("detects check", () => {
    const game = new GameSession("4k3/8/8/8/8/8/8/4K2R w K - 0 1");
    play(game, "h1h8");
    expect(game.status()).toEqual({ kind: "playing", turn: "b", check: true });
  });

  it("detects a position that's already checkmate", () => {
    const game = new GameSession("R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1");
    expect(game.status()).toEqual({ kind: "checkmate", winner: "w" });
  });

  it("detects stalemate", () => {
    expect(new GameSession("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1").status()).toEqual({ kind: "stalemate" });
  });

  it.each([
    ["king against king", "8/8/8/4k3/8/4K3/8/8 w - - 0 1"],
    ["king and bishop against king", "8/8/8/4k3/8/4KB2/8/8 w - - 0 1"],
    ["king and knight against king", "8/8/8/4k3/8/4KN2/8/8 b - - 0 1"],
  ])("detects a draw by %s", (_name, fen) => {
    expect(new GameSession(fen).status()).toEqual({ kind: "draw", reason: "insufficient_material" });
  });

  it("detects the fifty-move rule, using the clock from the FEN", () => {
    const game = new GameSession("4k3/8/8/8/8/8/4P3/4K3 w - - 99 80");
    expect(game.isOver).toBe(false);
    play(game, "e1d1");
    expect(game.status()).toEqual({ kind: "draw", reason: "fifty_moves" });
  });

  it("resets the fifty-move clock on a pawn move", () => {
    const game = new GameSession("4k3/8/8/8/8/8/4P3/4K3 w - - 99 80");
    play(game, "e2e3");
    expect(game.isOver).toBe(false);
  });

  it("detects threefold repetition, counting the starting position", () => {
    const game = new GameSession("4k3/4p3/8/8/8/8/4P3/4K3 w - - 0 1");
    play(game, "e1d1", "e8d8", "d1e1", "d8e8");
    expect(game.isOver).toBe(false);
    play(game, "e1d1", "e8d8", "d1e1", "d8e8");
    expect(game.status()).toEqual({ kind: "draw", reason: "threefold" });
  });
});

describe("undo and restart", () => {
  it("undo steps back through castling, en passant and promotion", () => {
    const fen = "r3k3/7P/8/3pP3/8/8/8/4K2R w Kq d6 0 5";
    const game = new GameSession(fen);
    play(game, "e5d6", "e8c8", "e1g1", "c8d7", "h7h8q");
    for (let i = 0; i < 5; i += 1) expect(game.undo()).toBe(true);
    expect(game.fen).toBe(fen);
    expect(game.moveCount).toBe(0);
  });

  it("does nothing when there's nothing to undo", () => {
    const game = new GameSession(START);
    expect(game.undo()).toBe(false);
    expect(game.fen).toBe(START);
  });

  it("can undo out of a finished game", () => {
    const game = new GameSession(START);
    play(game, "f2f3", "e7e5", "g2g4", "d8h4");
    game.undo();
    expect(game.isOver).toBe(false);
    expect(game.move("d8", "h4")).toBe(true);
  });

  it("undoing clears repetition counts", () => {
    const game = new GameSession("4k3/4p3/8/8/8/8/4P3/4K3 w - - 0 1");
    play(game, "e1d1", "e8d8", "d1e1", "d8e8", "e1d1", "e8d8", "d1e1", "d8e8");
    expect(game.isOver).toBe(true);
    game.undo();
    expect(game.isOver).toBe(false);
  });

  it("restart returns to the exact starting position, not the standard one", () => {
    const fen = "4k3/8/8/8/8/8/4P3/4K3 b - - 12 40";
    const game = new GameSession(fen);
    play(game, "e8d8", "e2e4");
    game.restart();
    expect(game.fen).toBe(fen);
    expect(game.moveCount).toBe(0);
    expect(game.scoresheet()).toEqual([]);
  });
});

describe("scoresheet", () => {
  it("numbers moves in pairs", () => {
    const game = new GameSession(START);
    play(game, "e2e4", "e7e5", "g1f3");
    expect(game.scoresheet()).toEqual([
      { number: 1, white: "e4", black: "e5" },
      { number: 2, white: "Nf3", black: null },
    ]);
  });

  it("uses the position's move number and leaves White's cell empty if Black starts", () => {
    const game = new GameSession("4k3/8/8/8/8/8/4P3/4K3 b - - 0 30");
    play(game, "e8d8", "e2e4", "d8e8");
    expect(game.scoresheet()).toEqual([
      { number: 30, white: null, black: "Kd8" },
      { number: 31, white: "e4", black: "Ke8" },
    ]);
  });
});

describe("destinations", () => {
  it("lists a promotion square once, despite four promotion moves", () => {
    const game = new GameSession("8/P6k/8/8/8/8/7K/8 w - - 0 1");
    expect(game.destinations().get("a7")).toEqual(["a8"]);
  });

  it("matches the legal moves at the start", () => {
    const destinations = new GameSession(START).destinations();
    expect([...destinations.values()].flat()).toHaveLength(20);
  });
});
