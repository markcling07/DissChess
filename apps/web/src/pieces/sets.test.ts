import { afterEach, describe, expect, it } from "vitest";
import {
  applyPieceSet,
  DEFAULT_PIECE_SET,
  PIECE_SETS,
  pieceSetCss,
  pieceUrl,
  savedPieceSet,
  savePieceSet,
  type PieceCode,
} from "./sets";

const CODES: PieceCode[] = ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"];

afterEach(() => localStorage.clear());

describe("piece sets", () => {
  it("has all twelve pieces for every set", () => {
    for (const set of PIECE_SETS) {
      for (const code of CODES) expect(pieceUrl(set.id, code)).toBeTruthy();
    }
  });

  it("starts with Cburnett", () => {
    expect(DEFAULT_PIECE_SET).toBe("cburnett");
    expect(savedPieceSet()).toBe("cburnett");
  });

  it("remembers the chosen set, and ignores one it doesn't know", () => {
    savePieceSet("merida");
    expect(savedPieceSet()).toBe("merida");
    localStorage.setItem("photo-to-chess:piece-set", "chess-com-neo");
    expect(savedPieceSet()).toBe("cburnett");
  });

  it("writes one rule per piece, and tones down only muted sets", () => {
    const css = pieceSetCss("cburnett");
    expect(css.match(/background-image/g)).toHaveLength(12);
    expect(css).toContain(".cg-wrap piece.knight.black");
    expect(css).not.toContain("saturate");
    expect(pieceSetCss("celtic")).toContain("saturate(0.15)");
  });

  it("replaces the page's piece styles when the set changes", () => {
    applyPieceSet("pixel");
    applyPieceSet("fantasy");
    const styles = document.querySelectorAll("#piece-set-style");
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toBe(pieceSetCss("fantasy"));
    expect(document.documentElement.dataset.pieceSet).toBe("fantasy");
  });
});
