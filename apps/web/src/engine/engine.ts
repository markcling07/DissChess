/**
 * Runs Stockfish in a worker, one search at a time. A search can be cancelled at any point, which
 * matters because the position changes whenever someone moves. If the engine crashes or hangs, the
 * current search fails with an error and the next one starts a fresh engine.
 */
import type { Color } from "chess.js";
import { parseBestMove, parseInfo, toWhiteView, type Score } from "./uci";

export interface EngineWorker {
  postMessage(message: string): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface SearchRequest {
  readonly fen: string;
  readonly depth?: number;
  readonly movetimeMs?: number;
  readonly multipv?: number;
  /** 0 to 20, where 20 is full strength. */
  readonly skill?: number;
}

export interface EngineLine {
  readonly multipv: number;
  readonly depth: number;
  /** Always from White's point of view. */
  readonly score: Score;
  readonly pv: readonly string[];
}

export interface SearchResult {
  /** Null if the side to move has no legal move, or the search was cancelled before it began. */
  readonly bestMove: string | null;
  readonly lines: readonly EngineLine[];
  readonly cancelled: boolean;
}

export interface SearchHandle {
  readonly promise: Promise<SearchResult>;
  cancel(): void;
}

export class EngineError extends Error {}

const BOOT_TIMEOUT_MS = 30_000;
const SEARCH_GRACE_MS = 20_000;
const UNBOUNDED_SEARCH_MS = 60_000;
const HASH_MB = 32;

interface Job {
  readonly request: SearchRequest;
  readonly onUpdate?: (lines: readonly EngineLine[]) => void;
  readonly resolve: (result: SearchResult) => void;
  readonly reject: (error: Error) => void;
  cancelled: boolean;
  searching: boolean;
}

function turnOf(fen: string): Color {
  return fen.split(" ")[1] === "b" ? "b" : "w";
}

export class Engine {
  private worker: EngineWorker | null = null;
  private booted = false;
  private queue: Job[] = [];
  private current: Job | null = null;
  private listener: ((line: string) => void) | null = null;
  private failure: ((error: Error) => void) | null = null;

  constructor(private readonly createWorker: () => EngineWorker) {}

  /** Queues a search. Its promise rejects with EngineError if the engine fails. */
  search(request: SearchRequest, onUpdate?: (lines: readonly EngineLine[]) => void): SearchHandle {
    let job!: Job;
    const promise = new Promise<SearchResult>((resolve, reject) => {
      job = { request, onUpdate, resolve, reject, cancelled: false, searching: false };
    });
    this.queue.push(job);
    void this.pump();
    return { promise, cancel: () => this.cancel(job) };
  }

  /** Checks that the engine can start, without searching. */
  async start(): Promise<void> {
    await this.search({ fen: "4k3/8/8/8/8/8/8/4K3 w - - 0 1", depth: 1 }).promise;
  }

  dispose(): void {
    for (const job of this.queue) job.resolve({ bestMove: null, lines: [], cancelled: true });
    this.queue = [];
    if (this.current) this.current.cancelled = true;
    this.failure?.(new EngineError("The engine was closed."));
    this.resetWorker();
  }

  private cancel(job: Job): void {
    job.cancelled = true;
    const queued = this.queue.indexOf(job);
    if (queued >= 0) {
      this.queue.splice(queued, 1);
      job.resolve({ bestMove: null, lines: [], cancelled: true });
    } else if (job.searching) {
      this.worker?.postMessage("stop");
    }
  }

  private async pump(): Promise<void> {
    if (this.current) return;
    const job = this.queue.shift();
    if (!job) return;
    this.current = job;
    try {
      await this.boot();
      job.resolve(await this.run(job));
    } catch (error) {
      this.resetWorker();
      job.reject(error instanceof EngineError ? error : new EngineError(String(error)));
    } finally {
      this.current = null;
      void this.pump();
    }
  }

  private resetWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    this.booted = false;
    this.listener = null;
    this.failure = null;
  }

  private send(command: string): void {
    this.worker?.postMessage(command);
  }

  /** Waits until a line of output satisfies the check, or the engine fails or takes too long. */
  private waitFor<T>(check: (line: string) => T | undefined, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listener = null;
        this.failure = null;
        reject(new EngineError("The engine stopped responding."));
      }, timeoutMs);
      this.failure = (error) => {
        clearTimeout(timer);
        this.listener = null;
        this.failure = null;
        reject(error);
      };
      this.listener = (line) => {
        const value = check(line);
        if (value !== undefined) {
          clearTimeout(timer);
          this.listener = null;
          this.failure = null;
          resolve(value);
        }
      };
    });
  }

  private async boot(): Promise<void> {
    if (this.booted) return;
    const worker = this.createWorker();
    this.worker = worker;
    worker.onmessage = (event) => {
      if (typeof event.data === "string") this.listener?.(event.data);
    };
    worker.onerror = () => {
      this.failure?.(new EngineError("The engine failed to run."));
    };

    const ready = this.waitFor((line) => (line === "uciok" ? true : undefined), BOOT_TIMEOUT_MS);
    this.send("uci");
    await ready;
    this.send(`setoption name Hash value ${HASH_MB}`);
    await this.sync();
    this.booted = true;
  }

  private async sync(): Promise<void> {
    const ready = this.waitFor((line) => (line === "readyok" ? true : undefined), BOOT_TIMEOUT_MS);
    this.send("isready");
    await ready;
  }

  private async run(job: Job): Promise<SearchResult> {
    if (job.cancelled) return { bestMove: null, lines: [], cancelled: true };
    const { fen, depth, movetimeMs, multipv = 1, skill = 20 } = job.request;
    const turn = turnOf(fen);
    const lines = new Map<number, EngineLine>();
    const sortedLines = () => [...lines.values()].sort((a, b) => a.multipv - b.multipv);

    this.send(`setoption name MultiPV value ${multipv}`);
    this.send(`setoption name Skill Level value ${skill}`);
    this.send(`position fen ${fen}`);
    await this.sync();
    if (job.cancelled) return { bestMove: null, lines: [], cancelled: true };

    const limits = [
      depth !== undefined ? `depth ${depth}` : "",
      movetimeMs !== undefined ? `movetime ${movetimeMs}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const timeout = (movetimeMs ?? UNBOUNDED_SEARCH_MS) + SEARCH_GRACE_MS;

    const finished = this.waitFor<string | null>((line) => {
      const best = parseBestMove(line);
      if (best !== undefined) return best;
      const info = parseInfo(line);
      if (info) {
        lines.set(info.multipv, {
          multipv: info.multipv,
          depth: info.depth,
          score: toWhiteView(info.score, turn),
          pv: info.pv,
        });
        if (!job.cancelled) job.onUpdate?.(sortedLines());
      }
      return undefined;
    }, timeout);

    job.searching = true;
    this.send(`go ${limits || "depth 12"}`);
    const bestMove = await finished;
    job.searching = false;
    return { bestMove, lines: sortedLines(), cancelled: job.cancelled };
  }
}
