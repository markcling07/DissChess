import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Engine, EngineError, type EngineWorker } from "./engine";
import { reviewGame, type PlayedMove } from "./review";
import { Chess } from "chess.js";

/** Follows the protocol just enough to test the queue, and records what it was told. */
class FakeWorker implements EngineWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  sent: string[] = [];
  terminated = false;
  autoFinish = true;

  emit(line: string) {
    this.onmessage?.({ data: line });
  }

  postMessage(message: string) {
    this.sent.push(message);
    queueMicrotask(() => {
      if (message === "uci") this.emit("uciok");
      if (message === "isready") this.emit("readyok");
      if (message.startsWith("go") && this.autoFinish) {
        this.emit("info depth 3 multipv 1 score cp 25 pv e2e4 e7e5");
        this.emit("bestmove e2e4");
      }
      if (message === "stop") this.emit("bestmove a2a3");
    });
  }

  terminate() {
    this.terminated = true;
  }
}

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const BLACK_TO_MOVE = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

function setup() {
  const workers: FakeWorker[] = [];
  const engine = new Engine(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  return { engine, workers };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Engine", () => {
  it("starts the engine once, and only when first needed", async () => {
    const { engine, workers } = setup();
    expect(workers).toHaveLength(0);
    await engine.search({ fen: START, depth: 2 }).promise;
    await engine.search({ fen: START, depth: 2 }).promise;
    expect(workers).toHaveLength(1);
    expect(workers[0]!.sent.filter((c) => c === "uci")).toHaveLength(1);
  });

  it("sends the position, limits and strength", async () => {
    const { engine, workers } = setup();
    await engine.search({ fen: START, depth: 9, movetimeMs: 200, multipv: 3, skill: 4 }).promise;
    const sent = workers[0]!.sent;
    expect(sent).toContain(`position fen ${START}`);
    expect(sent).toContain("setoption name MultiPV value 3");
    expect(sent).toContain("setoption name Skill Level value 4");
    expect(sent).toContain("go depth 9 movetime 200");
  });

  it("returns the best move and lines, with scores from White's view", async () => {
    const { engine } = setup();
    const white = await engine.search({ fen: START, depth: 1 }).promise;
    expect(white.bestMove).toBe("e2e4");
    expect(white.lines[0]?.score).toEqual({ kind: "cp", value: 25 });
    const black = await engine.search({ fen: BLACK_TO_MOVE, depth: 1 }).promise;
    expect(black.lines[0]?.score).toEqual({ kind: "cp", value: -25 });
  });

  it("reports progress as lines arrive", async () => {
    const { engine } = setup();
    const updates: number[] = [];
    await engine.search({ fen: START, depth: 1 }, (lines) => updates.push(lines.length)).promise;
    expect(updates).toEqual([1]);
  });

  it("runs searches one at a time, in order", async () => {
    const { engine, workers } = setup();
    const first = engine.search({ fen: START, depth: 1 });
    const second = engine.search({ fen: BLACK_TO_MOVE, depth: 1 });
    await Promise.all([first.promise, second.promise]);
    const positions = workers[0]!.sent.filter((c) => c.startsWith("position"));
    expect(positions).toEqual([`position fen ${START}`, `position fen ${BLACK_TO_MOVE}`]);
  });

  it("cancelling a queued search means it never runs", async () => {
    const { engine, workers } = setup();
    const first = engine.search({ fen: START, depth: 1 });
    const second = engine.search({ fen: BLACK_TO_MOVE, depth: 1 });
    second.cancel();
    expect(await second.promise).toEqual({ bestMove: null, lines: [], cancelled: true });
    await first.promise;
    expect(workers[0]!.sent.some((c) => c.includes(BLACK_TO_MOVE))).toBe(false);
  });

  it("cancelling a running search stops it, and the next search still works", async () => {
    const { engine, workers } = setup();
    const running = engine.search({ fen: START, depth: 30 });
    workers[0]!.autoFinish = false;
    await vi.waitFor(() => expect(workers[0]?.sent.some((c) => c.startsWith("go"))).toBe(true));
    running.cancel();
    const result = await running.promise;
    expect(result.cancelled).toBe(true);
    expect(workers[0]!.sent).toContain("stop");

    workers[0]!.autoFinish = true;
    expect((await engine.search({ fen: START, depth: 1 }).promise).bestMove).toBe("e2e4");
  });

  it("reports no legal move as null", async () => {
    const engine = new Engine(() => {
      const worker = new FakeWorker();
      worker.autoFinish = false;
      const post = worker.postMessage.bind(worker);
      worker.postMessage = (message) => {
        post(message);
        if (message.startsWith("go")) queueMicrotask(() => worker.emit("bestmove (none)"));
      };
      return worker;
    });
    const result = await engine.search({ fen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", depth: 1 }).promise;
    expect(result.bestMove).toBeNull();
    expect(result.lines).toEqual([]);
  });

  it("fails with a clear error if the engine can't be created, then tries again", async () => {
    let attempts = 0;
    const engine = new Engine(() => {
      attempts += 1;
      if (attempts === 1) throw new Error("Worker blocked");
      return new FakeWorker();
    });
    await expect(engine.search({ fen: START, depth: 1 }).promise).rejects.toBeInstanceOf(EngineError);
    expect((await engine.search({ fen: START, depth: 1 }).promise).bestMove).toBe("e2e4");
    expect(attempts).toBe(2);
  });

  it("fails if the worker crashes mid-search, and starts a fresh one for the next search", async () => {
    const { engine, workers } = setup();
    const search = engine.search({ fen: START, depth: 30 });
    workers[0]!.autoFinish = false;
    await vi.waitFor(() => expect(workers[0]?.sent.some((c) => c.startsWith("go"))).toBe(true));
    workers[0]!.onerror?.({});
    await expect(search.promise).rejects.toBeInstanceOf(EngineError);
    expect(workers[0]!.terminated).toBe(true);

    expect((await engine.search({ fen: START, depth: 1 }).promise).bestMove).toBe("e2e4");
    expect(workers).toHaveLength(2);
  });

  it("fails if the engine goes silent, and doesn't hang", async () => {
    vi.useFakeTimers();
    const { engine, workers } = setup();
    const search = engine.search({ fen: START, movetimeMs: 100 });
    workers[0]!.autoFinish = false;
    const failure = expect(search.promise).rejects.toThrow("stopped responding");
    await vi.advanceTimersByTimeAsync(25_000);
    await failure;
  });

  it("disposing cancels what's waiting and closes the worker", async () => {
    const { engine, workers } = setup();
    await engine.search({ fen: START, depth: 1 }).promise;
    const queued = engine.search({ fen: START, depth: 1 });
    engine.dispose();
    await queued.promise.catch(() => undefined);
    expect(workers[0]!.terminated).toBe(true);
  });
});

/** The real Stockfish, run through Node. These prove the protocol handling against the real thing. */
describe("with the real engine", () => {
  const require = createRequire(import.meta.url);
  const stockfish = require("stockfish") as { findEngine(name: string): string };

  /** The same engine file the browser uses, as a separate process speaking the same protocol. */
  function realEngine(): Engine {
    return new Engine(() => {
      const child = spawn(process.execPath, [stockfish.findEngine("lite-single")], { stdio: "pipe" });
      let buffer = "";
      const worker: EngineWorker = {
        onmessage: null,
        onerror: null,
        postMessage(message) {
          child.stdin.write(`${message}\n`);
        },
        terminate() {
          child.kill();
        },
      };
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) worker.onmessage?.({ data: line });
      });
      child.on("error", (error) => worker.onerror?.(error));
      return worker;
    });
  }

  it("finds mate in one", { timeout: 60_000 }, async () => {
    const engine = realEngine();
    const fen = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
    const result = await engine.search({ fen, depth: 6 }).promise;
    expect(result.bestMove).toBe("h5f7");
    expect(result.lines[0]?.score).toEqual({ kind: "mate", value: 1 });
    engine.dispose();
  });

  it("from Black's side, reports the score from White's view", { timeout: 60_000 }, async () => {
    const engine = realEngine();
    const fen = "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2";
    const result = await engine.search({ fen, depth: 6 }).promise;
    expect(result.bestMove).toBe("d8h4");
    expect(result.lines[0]?.score).toEqual({ kind: "mate", value: -1 });
    engine.dispose();
  });

  it("gives several lines, best first, all legal", { timeout: 60_000 }, async () => {
    const engine = realEngine();
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const result = await engine.search({ fen, depth: 8, multipv: 3 }).promise;
    expect(result.lines.map((l) => l.multipv)).toEqual([1, 2, 3]);
    const firstMoves = new Set(result.lines.map((l) => l.pv[0]));
    expect(firstMoves.size).toBe(3);
    const legal = new Chess(fen).moves({ verbose: true }).map((m) => m.lan);
    for (const line of result.lines) expect(legal).toContain(line.pv[0]);
    engine.dispose();
  });

  it("reports stalemate and checkmate as no legal move", { timeout: 60_000 }, async () => {
    const engine = realEngine();
    const result = await engine.search({ fen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", depth: 3 }).promise;
    expect(result.bestMove).toBeNull();
    engine.dispose();
  });

  it("promotes when that's the best move", { timeout: 60_000 }, async () => {
    const engine = realEngine();
    // Promoting here is immediate checkmate, as a queen or a rook.
    const result = await engine.search({ fen: "k7/7P/1K6/8/8/8/8/8 w - - 0 1", depth: 8 }).promise;
    expect(result.bestMove).toMatch(/^h7h8[qr]$/);
    engine.dispose();
  });

  it("can be cancelled, then searches again", { timeout: 60_000 }, async () => {
    const engine = realEngine();
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const long = engine.search({ fen, depth: 40 });
    await new Promise((done) => setTimeout(done, 300));
    long.cancel();
    expect((await long.promise).cancelled).toBe(true);
    expect((await engine.search({ fen, depth: 3 }).promise).bestMove).toBeTruthy();
    engine.dispose();
  });

  it("a review marks a hanging queen as a blunder and leaves a sound move alone", { timeout: 120_000 }, async () => {
    const engine = realEngine();
    const chess = new Chess("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2");
    const moves: PlayedMove[] = [];
    for (const san of ["Nf3", "Qg5", "Nxg5"]) {
      const move = chess.move(san);
      moves.push({ san: move.san, color: move.color, before: move.before, after: move.after });
    }
    const progress: number[] = [];
    const review = await reviewGame(engine, moves, (done) => progress.push(done), new AbortController().signal);
    expect(progress).toEqual([1, 2, 3]);
    expect(review?.moves[0]?.quality).toBeNull();
    expect(review?.moves[1]?.san).toBe("Qg5");
    expect(review?.moves[1]?.quality).toBe("blunder");
    expect(review?.moves[1]?.better).toBeTruthy();
    expect(review?.moves[2]?.quality).toBeNull();
    engine.dispose();
  });

  it("a review can be cancelled", { timeout: 60_000 }, async () => {
    const engine = realEngine();
    const chess = new Chess();
    const moves: PlayedMove[] = [];
    for (const san of ["e4", "e5", "Nf3", "Nc6"]) {
      const move = chess.move(san);
      moves.push({ san: move.san, color: move.color, before: move.before, after: move.after });
    }
    const controller = new AbortController();
    const review = await reviewGame(engine, moves, () => controller.abort(), controller.signal);
    expect(review).toBeNull();
    engine.dispose();
  });
});
