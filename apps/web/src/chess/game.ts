/** A game in progress from any validated position. All rules come from chess.js. */
import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";

export type PromotionPiece = Extract<PieceSymbol, "q" | "r" | "b" | "n">;

export type GameStatus =
  | { kind: "playing"; turn: Color; check: boolean }
  | { kind: "checkmate"; winner: Color }
  | { kind: "stalemate" }
  | { kind: "draw"; reason: "insufficient_material" | "fifty_moves" | "threefold" };

export interface ScoresheetRow {
  readonly number: number;
  readonly white: string | null;
  readonly black: string | null;
}

export class GameSession {
  readonly startFen: string;
  private chess: Chess;

  /** Throws if chess.js rejects the FEN. Run validatePosition first to explain why to the user. */
  constructor(startFen: string) {
    this.startFen = startFen;
    this.chess = new Chess(startFen);
  }

  get fen(): string {
    return this.chess.fen();
  }

  get turn(): Color {
    return this.chess.turn();
  }

  get moveCount(): number {
    return this.chess.history().length;
  }

  get isOver(): boolean {
    return this.status().kind !== "playing";
  }

  get lastMove(): [Square, Square] | null {
    const last = this.chess.history({ verbose: true }).at(-1);
    return last ? [last.from, last.to] : null;
  }

  status(): GameStatus {
    if (this.chess.isCheckmate()) {
      return { kind: "checkmate", winner: this.turn === "w" ? "b" : "w" };
    }
    if (this.chess.isStalemate()) return { kind: "stalemate" };
    if (this.chess.isInsufficientMaterial()) return { kind: "draw", reason: "insufficient_material" };
    if (this.chess.isDrawByFiftyMoves()) return { kind: "draw", reason: "fifty_moves" };
    if (this.chess.isThreefoldRepetition()) return { kind: "draw", reason: "threefold" };
    return { kind: "playing", turn: this.turn, check: this.chess.isCheck() };
  }

  /** Legal moves as origin square to destination squares. Empty once the game is over. */
  destinations(): Map<Square, Square[]> {
    const destinations = new Map<Square, Square[]>();
    if (this.isOver) return destinations;
    for (const move of this.chess.moves({ verbose: true })) {
      const targets = destinations.get(move.from);
      if (targets) {
        if (!targets.includes(move.to)) targets.push(move.to);
      } else {
        destinations.set(move.from, [move.to]);
      }
    }
    return destinations;
  }

  /** Whether this legal move needs a promotion piece chosen. */
  isPromotion(from: Square, to: Square): boolean {
    return this.chess
      .moves({ square: from, verbose: true })
      .some((move) => move.to === to && move.promotion !== undefined);
  }

  /** Plays a move and returns true, or returns false and changes nothing if it isn't legal. */
  move(from: Square, to: Square, promotion?: PromotionPiece): boolean {
    if (this.isOver) return false;
    try {
      this.chess.move({ from, to, promotion });
      return true;
    } catch {
      return false;
    }
  }

  undo(): boolean {
    return this.chess.undo() !== null;
  }

  restart(): void {
    this.chess = new Chess(this.startFen);
  }

  /** Each move played, with the positions either side of it. */
  plies(): { san: string; color: Color; before: string; after: string }[] {
    return this.chess
      .history({ verbose: true })
      .map(({ san, color, before, after }) => ({ san, color, before, after }));
  }

  /** Move history in scoresheet rows. A game starting with Black to move leaves White's cell empty. */
  scoresheet(): ScoresheetRow[] {
    const start = new Chess(this.startFen);
    let number = start.moveNumber();
    const rows: ScoresheetRow[] = [];
    let white: string | null = null;
    let colorToMove = start.turn();

    for (const san of this.chess.history()) {
      if (colorToMove === "w") {
        white = san;
      } else {
        rows.push({ number, white, black: san });
        white = null;
        number += 1;
      }
      colorToMove = colorToMove === "w" ? "b" : "w";
    }
    if (white !== null) rows.push({ number, white, black: null });
    return rows;
  }
}
