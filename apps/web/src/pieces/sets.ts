/**
 * The piece sets the app can show. All are free to use here; each folder holds its artwork and its
 * licence, and docs/third-party.md credits the authors. The chosen set is remembered on this device.
 */

export type PieceCode = `${"w" | "b"}${"K" | "Q" | "R" | "B" | "N" | "P"}`;

export interface PieceSet {
  readonly id: string;
  readonly name: string;
  readonly author: string;
  readonly licence: string;
  /** Artwork with a strong tint, toned down to neutral pieces wherever it's drawn. */
  readonly muted?: boolean;
}

export const PIECE_SETS: readonly PieceSet[] = [
  { id: "cburnett", name: "Cburnett", author: "Colin M.L. Burnett", licence: "GPL-2.0-or-later" },
  { id: "merida", name: "Merida", author: "Armando Hernandez Marroquin", licence: "GPL-2.0-or-later" },
  { id: "chessnut", name: "Chessnut", author: "Alexis Luengas", licence: "Apache-2.0" },
  { id: "celtic", name: "Celtic", author: "Maurizio Monge", licence: "MIT", muted: true },
  { id: "mpchess", name: "MPChess", author: "Maxime Chupin", licence: "GPL-3.0-or-later" },
  { id: "pirouetti", name: "Pirouetti", author: "pirouetti", licence: "AGPL-3.0-or-later" },
  { id: "fantasy", name: "Fantasy", author: "Maurizio Monge", licence: "MIT" },
  { id: "spatial", name: "Spatial", author: "Maurizio Monge", licence: "MIT" },
  { id: "rhosgfx", name: "RhosGFX", author: "RhosGFX", licence: "CC0-1.0" },
  { id: "papercut", name: "Papercut", author: "Nikolay Anzarov", licence: "CC-BY-4.0" },
  { id: "totoy", name: "Totoy", author: "Kosal Sen", licence: "CC-BY-4.0" },
  { id: "firi", name: "Firi", author: "James Faure", licence: "CC-BY-4.0" },
  { id: "pixel", name: "Pixel", author: "therealqtpi", licence: "AGPL-3.0-or-later" },
];

export const DEFAULT_PIECE_SET = "cburnett";
const STORAGE_KEY = "photo-to-chess:piece-set";
const STYLE_ID = "piece-set-style";

// Kept as separate files rather than packed into the script, so a set only downloads once it's shown.
const URLS = import.meta.glob("./*/*.svg", { eager: true, query: "?no-inline", import: "default" }) as Record<
  string,
  string
>;

export function pieceSet(id: string): PieceSet {
  return PIECE_SETS.find((set) => set.id === id) ?? PIECE_SETS.find((set) => set.id === DEFAULT_PIECE_SET)!;
}

export function pieceUrl(id: string, code: PieceCode): string {
  const url = URLS[`./${pieceSet(id).id}/${code}.svg`];
  if (!url) throw new Error(`No artwork for ${code} in ${id}`);
  return url;
}

/** The set chosen on this device, or the default when none was chosen or storage is unavailable. */
export function savedPieceSet(): string {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (saved && PIECE_SETS.some((set) => set.id === saved)) return saved;
  } catch {
    // Private windows and blocked storage fall back to the default.
  }
  return DEFAULT_PIECE_SET;
}

export function savePieceSet(id: string): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, pieceSet(id).id);
  } catch {
    // The choice still applies until the page is closed.
  }
}

const ROLES: Record<string, string> = { K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight", P: "pawn" };

/** The CSS that draws the board's pieces, and the pictures in the piece palette, with this set. */
export function pieceSetCss(id: string): string {
  const set = pieceSet(id);
  const rules = (["w", "b"] as const).flatMap((color) =>
    Object.entries(ROLES).map(
      ([letter, role]) =>
        `.cg-wrap piece.${role}.${color === "w" ? "white" : "black"}{background-image:url("${pieceUrl(set.id, `${color}${letter}` as PieceCode)}")}`,
    ),
  );
  if (set.muted) rules.push(".cg-wrap piece{filter:saturate(0.15)}");
  return rules.join("\n");
}

/** Shows this set everywhere pieces are drawn, by replacing the page's piece styles. */
export function applyPieceSet(id: string): void {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.append(style);
  }
  style.textContent = pieceSetCss(id);
  document.documentElement.dataset.pieceSet = pieceSet(id).id;
}
