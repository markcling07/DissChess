import { describe, expect, it } from "vitest";
import {
  canHoldCastlingRight,
  enPassantOptions,
  parseFen,
  parsePlacement,
  rotatePlacement,
  STANDARD_PLACEMENT,
  standardSetup,
  toFen,
  toPlacementString,
} from "./position";

const MIDGAME = "r1bq1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1";

describe("placement", () => {
  it("puts pieces on the right squares", () => {
    const placement = parsePlacement(STANDARD_PLACEMENT);
    expect(placement.size).toBe(32);
    expect(placement.get("e1")).toBe("K");
    expect(placement.get("e8")).toBe("k");
    expect(placement.get("a2")).toBe("P");
    expect(placement.has("e4")).toBe(false);
  });

  it.each([STANDARD_PLACEMENT, MIDGAME, "8/8/8/8/8/8/8/8", "k7/8/8/8/8/8/8/7K"])(
    "round trips %s",
    (text) => {
      expect(toPlacementString(parsePlacement(text))).toBe(text);
    },
  );

  it.each([
    "",
    "8/8/8/8/8/8/8",
    "8/8/8/8/8/8/8/8/8",
    "9/8/8/8/8/8/8/8",
    "ppppppppp/8/8/8/8/8/8/8",
    "ppppppp/8/8/8/8/8/8/8",
    "x7/8/8/8/8/8/8/8",
    "44/8/8/8/8/8/8/8",
  ])("rejects %s", (text) => {
    expect(() => parsePlacement(text)).toThrow();
  });
});

describe("rotation", () => {
  it("turns a1 to a8 to h8 to h1 to a1", () => {
    const a1 = parsePlacement("8/8/8/8/8/8/8/K7");
    const once = rotatePlacement(a1);
    expect(once.get("a8")).toBe("K");
    const twice = rotatePlacement(once);
    expect(twice.get("h8")).toBe("K");
    const thrice = rotatePlacement(twice);
    expect(thrice.get("h1")).toBe("K");
    expect(rotatePlacement(thrice).get("a1")).toBe("K");
  });

  it("restores any position after four turns", () => {
    let placement = parsePlacement(MIDGAME);
    for (let i = 0; i < 4; i += 1) placement = rotatePlacement(placement);
    expect(toPlacementString(placement)).toBe(MIDGAME);
  });
});

describe("FEN", () => {
  it("writes the standard position", () => {
    expect(toFen(standardSetup())).toBe(`${STANDARD_PLACEMENT} w KQkq - 0 1`);
  });

  it("refuses to write a FEN without a side to move", () => {
    expect(() => toFen({ ...standardSetup(), sideToMove: null })).toThrow();
  });

  it("round trips a full FEN", () => {
    const fen = "rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b Kq e3 0 3";
    expect(toFen(parseFen(fen))).toBe(fen);
  });

  it("leaves missing fields unset instead of guessing", () => {
    const setup = parseFen(STANDARD_PLACEMENT);
    expect(setup.sideToMove).toBeNull();
    expect(setup.castling).toEqual({ K: false, Q: false, k: false, q: false });
    expect(setup.enPassant).toBeNull();
    expect(setup.halfmove).toBe(0);
    expect(setup.fullmove).toBe(1);
  });

  it("still loads a position with problems, so it can be fixed", () => {
    expect(parseFen("8/8/8/8/8/8/8/8 w KQkq - 0 1").placement.size).toBe(0);
  });

  it.each([
    "",
    `${STANDARD_PLACEMENT} x`,
    `${STANDARD_PLACEMENT} w XY`,
    `${STANDARD_PLACEMENT} w qK`,
    `${STANDARD_PLACEMENT} w - z9`,
    `${STANDARD_PLACEMENT} w - - a`,
    `${STANDARD_PLACEMENT} w - - -1`,
    `${STANDARD_PLACEMENT} w - - 0 b`,
    `${STANDARD_PLACEMENT} w - - 0 1 extra`,
  ])("rejects %j", (fen) => {
    expect(() => parseFen(fen)).toThrow();
  });
});

describe("castling availability", () => {
  it("needs both the king and the rook at home", () => {
    const placement = parsePlacement("r3k3/8/8/8/8/8/8/4K2R");
    expect(canHoldCastlingRight(placement, "K")).toBe(true);
    expect(canHoldCastlingRight(placement, "Q")).toBe(false);
    expect(canHoldCastlingRight(placement, "q")).toBe(true);
    expect(canHoldCastlingRight(placement, "k")).toBe(false);
  });
});

describe("en passant options", () => {
  it("offers a target only when a pawn could capture", () => {
    const blackJustPushed = parsePlacement("4k3/8/8/3pP3/8/8/8/4K3");
    expect(enPassantOptions(blackJustPushed, "w")).toEqual(["d6"]);
    const noCapturer = parsePlacement("4k3/8/8/3p4/8/8/8/4K3");
    expect(enPassantOptions(noCapturer, "w")).toEqual([]);
  });

  it("works for Black and for both neighbours", () => {
    const placement = parsePlacement("4k3/8/8/8/2pPp3/8/8/4K3");
    expect(enPassantOptions(placement, "b")).toEqual(["d3"]);
  });

  it("doesn't offer a target if the pawn couldn't have just moved two squares", () => {
    const originOccupied = parsePlacement("4k3/3p4/8/3pP3/8/8/8/4K3");
    expect(enPassantOptions(originOccupied, "w")).toEqual([]);
  });
});
