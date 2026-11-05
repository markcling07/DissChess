import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { parseFen, standardSetup, toFen, toPlacementString } from "./position";
import crosscheck from "./rules-crosscheck.json";
import { forcedSideToMove, hasBlockingIssue, validatePosition, type IssueCode } from "./validate";

function codes(fen: string): IssueCode[] {
  return validatePosition(parseFen(fen)).map((issue) => issue.code);
}

describe("validatePosition", () => {
  it("accepts the standard position", () => {
    expect(validatePosition(standardSetup())).toEqual([]);
  });

  it.each<[string, string, IssueCode]>([
    ["a missing white king", "4k3/8/8/8/8/8/8/8 w - - 0 1", "missing_king"],
    ["a missing black king", "8/8/8/8/8/8/8/4K3 w - - 0 1", "missing_king"],
    ["an empty board", "8/8/8/8/8/8/8/8 w - - 0 1", "missing_king"],
    ["two white kings", "4k3/8/8/8/8/8/8/K3K3 w - - 0 1", "extra_king"],
    ["a white pawn on rank 8", "P3k3/8/8/8/8/8/8/4K3 b - - 0 1", "pawn_on_back_rank"],
    ["a black pawn on rank 1", "4k3/8/8/8/8/8/8/p3K3 w - - 0 1", "pawn_on_back_rank"],
    ["nine pawns", "4k3/8/8/8/P7/8/PPPPPPPP/4K3 w - - 0 1", "too_many_pawns"],
    ["seventeen pieces", "4k3/8/8/N7/NN6/NNNNNNNN/NNNNNNNN/4K3 w - - 0 1", "too_many_pieces"],
    ["adjacent kings", "8/8/8/3kK3/8/8/8/8 w - - 0 1", "kings_adjacent"],
    ["no chosen side", "4k3/8/8/8/8/8/8/4K3", "side_to_move_missing"],
    ["a checked side that isn't to move", "4k3/8/8/8/8/8/4R3/4K3 w - - 0 1", "side_not_to_move_in_check"],
    ["both kings in check", "4k3/4R3/8/8/8/8/4r3/4K3 w - - 0 1", "both_kings_in_check"],
    ["three checkers", "4k3/8/8/8/1b6/8/6n1/r3K3 w - - 0 1", "too_many_checkers"],
    ["castling with no rook", "4k3/8/8/8/8/8/8/4K3 w K - 0 1", "castling_invalid"],
    ["castling with the king away", "4k3/8/8/8/8/8/8/3K3R w K - 0 1", "castling_invalid"],
    ["en passant with no pawn", "4k3/8/8/8/8/8/8/4K3 w - e6 0 1", "en_passant_invalid"],
    ["en passant on the wrong rank", "4k3/8/8/4p3/8/8/8/4K3 w - e3 0 1", "en_passant_invalid"],
  ])("blocks %s", (_name, fen, code) => {
    const issues = validatePosition(parseFen(fen));
    expect(issues.map((issue) => issue.code)).toContain(code);
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it.each(["halfmove", "fullmove"] as const)("blocks an invalid %s", (field) => {
    const setup = { ...standardSetup(), [field]: -1 };
    expect(validatePosition(setup).map((issue) => issue.code)).toContain("counters_invalid");
  });

  it("warns but doesn't block on more promoted pieces than missing pawns", () => {
    const issues = validatePosition(parseFen("4k3/8/8/8/8/QQ6/PPPPPPPP/4K3 w - - 0 1"));
    expect(issues.map((issue) => issue.code)).toEqual(["impossible_promotion_count"]);
    expect(hasBlockingIssue(issues)).toBe(false);
  });

  it("counts two bishops on one square colour as a promotion", () => {
    expect(codes("4k3/8/8/8/8/8/PPPPPPPP/2B1KB2 w - - 0 1")).toEqual([]);
    expect(codes("4k3/8/8/8/8/8/PPPPPPPP/1B2K1B1 w - - 0 1")).toEqual([]);
    expect(codes("4k3/8/8/8/8/8/PPPPPPPP/B1B1K3 w - - 0 1")).toEqual(["impossible_promotion_count"]);
    expect(codes("4k3/8/8/8/8/8/PPPPPPPP/1B2KB2 w - - 0 1")).toEqual(["impossible_promotion_count"]);
  });

  it("warns on an en passant square with a non-zero halfmove clock", () => {
    const fen = "4k3/8/8/3pP3/8/8/8/4K3 w - d6 5 9";
    expect(codes(fen)).toEqual(["halfmove_after_en_passant"]);
  });

  it("points at the squares involved", () => {
    const [issue] = validatePosition(parseFen("4k3/8/8/8/8/8/8/K3K3 w - - 0 1"));
    expect(issue?.squares).toEqual(expect.arrayContaining(["a1", "e1"]));
  });
});

describe("forcedSideToMove", () => {
  it("is the side in check", () => {
    expect(forcedSideToMove(parseFen("4k3/4R3/8/8/8/8/8/4K3").placement)).toBe("b");
    expect(forcedSideToMove(parseFen("4k3/8/8/8/8/8/4r3/4K3").placement)).toBe("w");
  });

  it("is unknown otherwise", () => {
    expect(forcedSideToMove(standardSetup().placement)).toBeNull();
    expect(forcedSideToMove(parseFen("4k3/4R3/8/8/8/8/4r3/4K3").placement)).toBeNull();
    expect(forcedSideToMove(parseFen("8/8/8/8/8/8/8/8").placement)).toBeNull();
  });
});

describe("cross-check with python-chess", () => {
  it("has a useful mix of valid and invalid layouts", () => {
    const valid = crosscheck.validity.filter((c) => c.flags.length === 0).length;
    expect(valid).toBeGreaterThan(50);
    expect(crosscheck.validity.length - valid).toBeGreaterThan(50);
  });

  it("blocks exactly the positions python-chess calls invalid", () => {
    const disagreements = crosscheck.validity.filter(({ fen, flags }) => {
      const blocked = hasBlockingIssue(validatePosition(parseFen(fen)));
      return blocked !== flags.length > 0;
    });
    expect(disagreements).toEqual([]);
  });

  it("only lets through positions that chess.js can load and play, unchanged", () => {
    for (const { fen } of crosscheck.validity) {
      const setup = parseFen(fen);
      if (hasBlockingIssue(validatePosition(setup))) continue;
      const game = new Chess(toFen(setup));
      expect(game.fen().split(" ")[0]).toBe(toPlacementString(setup.placement));
      expect(game.turn()).toBe(setup.sideToMove);
      expect(() => game.moves()).not.toThrow();
    }
  });
});
