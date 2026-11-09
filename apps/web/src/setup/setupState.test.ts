import { describe, expect, it } from "vitest";
import { emptySetup, parseFen, standardSetup, toPlacementString } from "../chess/position";
import { effectiveSide, resolveSetup, setupReducer } from "./setupState";

describe("setupReducer", () => {
  it("places, replaces and removes pieces", () => {
    let setup = setupReducer(emptySetup(), { type: "place", square: "e4", piece: "Q" });
    expect(setup.placement.get("e4")).toBe("Q");
    setup = setupReducer(setup, { type: "place", square: "e4", piece: "n" });
    expect(setup.placement.get("e4")).toBe("n");
    setup = setupReducer(setup, { type: "remove", square: "e4" });
    expect(setup.placement.size).toBe(0);
  });

  it("doesn't change the previous state", () => {
    const before = emptySetup();
    setupReducer(before, { type: "place", square: "e4", piece: "Q" });
    expect(before.placement.size).toBe(0);
  });

  it("turns off a castling right when its rook leaves", () => {
    const setup = setupReducer(standardSetup(), { type: "remove", square: "h1" });
    expect(setup.castling).toEqual({ K: false, Q: true, k: true, q: true });
  });

  it("turns off both rights when the king leaves, and restores them when it's back", () => {
    let setup = setupReducer(standardSetup(), { type: "remove", square: "e8" });
    expect(setup.castling).toEqual({ K: true, Q: true, k: false, q: false });
    setup = setupReducer(setup, { type: "place", square: "e8", piece: "k" });
    expect(setup.castling).toEqual({ K: true, Q: true, k: true, q: true });
  });

  it("gives a hand-arranged board castling wherever king and rook are at home", () => {
    let setup = emptySetup();
    for (const [square, piece] of [["e1", "K"], ["h1", "R"], ["a8", "r"], ["d8", "k"]] as const) {
      setup = setupReducer(setup, { type: "place", square, piece });
    }
    expect(setup.castling).toEqual({ K: true, Q: false, k: false, q: false });
  });

  it("rotates clockwise and clears details that no longer fit", () => {
    const setup = setupReducer(standardSetup(), { type: "rotate" });
    // White's back rank ends up on the a-file, with a1 at the top.
    expect(toPlacementString(setup.placement)).toBe("RP4pr/NP4pn/BP4pb/QP4pq/KP4pk/BP4pb/NP4pn/RP4pr");
    expect(setup.castling).toEqual({ K: false, Q: false, k: false, q: false });
  });

  it("clears to nothing, with the side undecided", () => {
    const setup = setupReducer(standardSetup(), { type: "clear" });
    expect(setup.placement.size).toBe(0);
    expect(setup.sideToMove).toBeNull();
  });

  it("the standard position sets the side and all rights", () => {
    const setup = setupReducer(emptySetup(), { type: "standard" });
    expect(setup.placement.size).toBe(32);
    expect(setup.sideToMove).toBe("w");
    expect(setup.castling).toEqual({ K: true, Q: true, k: true, q: true });
  });

  it("only keeps an en passant square that fits the board and side", () => {
    let setup = parseFen("4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1");
    setup = setupReducer(setup, { type: "setEnPassant", square: "d6" });
    expect(setup.enPassant).toBe("d6");
    expect(setupReducer(setup, { type: "setSide", side: "b" }).enPassant).toBeNull();
    expect(setupReducer(setup, { type: "remove", square: "d5" }).enPassant).toBeNull();
    expect(setupReducer(setup, { type: "setEnPassant", square: "e6" }).enPassant).toBeNull();
  });

  it("loading removes details that don't fit the board", () => {
    const setup = setupReducer(emptySetup(), {
      type: "load",
      setup: parseFen("4k3/8/8/8/8/8/8/4K3 w KQkq e6 3 9"),
    });
    expect(setup.castling).toEqual({ K: false, Q: false, k: false, q: false });
    expect(setup.enPassant).toBeNull();
    expect(setup.halfmove).toBe(3);
    expect(setup.fullmove).toBe(9);
  });
});

describe("side to move", () => {
  it("stays undecided until the user chooses", () => {
    expect(effectiveSide(parseFen("4k3/8/8/8/8/8/8/4K3"))).toBeNull();
  });

  it("follows a king in check, whatever was chosen", () => {
    const setup = parseFen("4k3/8/8/8/8/8/4R3/4K3 w - - 0 1");
    expect(effectiveSide(setup)).toBe("b");
    expect(resolveSetup(setup).sideToMove).toBe("b");
  });

  it("returns to the user's choice once the check is gone", () => {
    const inCheck = parseFen("4k3/8/8/8/8/8/4R3/4K3 w - - 0 1");
    const after = setupReducer(inCheck, { type: "remove", square: "e2" });
    expect(effectiveSide(after)).toBe("w");
  });
});
