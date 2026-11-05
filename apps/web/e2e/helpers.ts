import type { Page } from "@playwright/test";

/** Every piece on the board, read from Chessground's DOM, as e.g. "e1" -> "white king". */
export async function pieces(page: Page): Promise<Map<string, string>> {
  const list = await page.evaluate(() =>
    [...document.querySelectorAll("cg-board piece:not(.ghost)")].map((element) => {
      const piece = element as HTMLElement & { cgKey?: string };
      const name = piece.className.replace(/\b(anim|fading|dragging)\b/g, "").trim();
      return [piece.cgKey ?? "", name];
    }),
  );
  return new Map(list as [string, string][]);
}

const NAMES: Record<string, string> = {
  P: "white pawn",
  N: "white knight",
  B: "white bishop",
  R: "white rook",
  Q: "white queen",
  K: "white king",
  p: "black pawn",
  n: "black knight",
  b: "black bishop",
  r: "black rook",
  q: "black queen",
  k: "black king",
};

/** What the board should hold for the piece placement field of a FEN. */
export function expectedPieces(placement: string): [string, string][] {
  const expected: [string, string][] = [];
  placement.split("/").forEach((rank, index) => {
    let file = 0;
    for (const char of rank) {
      if (char >= "1" && char <= "8") {
        file += Number(char);
      } else {
        expected.push([`${"abcdefgh"[file]}${8 - index}`, NAMES[char]!]);
        file += 1;
      }
    }
  });
  return expected.sort(([a], [b]) => a.localeCompare(b));
}

export async function piecesSorted(page: Page): Promise<[string, string][]> {
  return [...(await pieces(page))].sort(([a], [b]) => a.localeCompare(b));
}
