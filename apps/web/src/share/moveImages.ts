/**
 * Draws a run of moves as pictures, one per move, for saving to a phone's photos. Everything is
 * drawn on this device and handed straight to the share menu or a download. Nothing is uploaded,
 * and nothing is kept once the pictures are saved.
 */
import { Chess, type Color, type Square } from "chess.js";
import { numberMoves, QUALITY_MARK, QUALITY_NAME, isError, type MoveQuality } from "../engine/evaluation";
import type { GameReview } from "../engine/review";
import { pieceSet, pieceUrl, type PieceCode } from "../pieces/sets";

export interface ClipMove {
  readonly san: string;
  readonly color: Color;
  readonly from: Square;
  readonly to: Square;
  readonly before: string;
  readonly after: string;
}

export interface MoveFrame {
  /** The move's position in the game, counting from 0. */
  readonly ply: number;
  /** The move with its number, like "14. Bxh7+". */
  readonly label: string;
  readonly from: Square;
  readonly to: Square;
  readonly after: string;
  readonly quality: MoveQuality | null;
  /** A line under the move saying what the review found, if anything. */
  readonly note: string | null;
}

/** 4:5, the tallest shape that photo feeds show without cropping. */
export const IMAGE_WIDTH = 1080;
export const IMAGE_HEIGHT = 1350;
export const MAX_CLIP_MOVES = 10;

const BOARD_X = 40;
const BOARD_Y = 120;
const BOARD_SIZE = 1000;
const SQUARE = BOARD_SIZE / 8;

const COLORS = {
  background: "#163a2c",
  dark: "#769556",
  light: "#eaedd1",
  lastMove: "rgba(248, 238, 163, 0.5)",
  text: "#efead2",
  quiet: "#bfd0bd",
};

const BADGE: Record<MoveQuality, { fill: string; text: string }> = {
  brilliant: { fill: "#1f9fb0", text: "#ffffff" },
  inaccuracy: { fill: "#f8eea3", text: "#163a2c" },
  mistake: { fill: "#e8930c", text: "#ffffff" },
  blunder: { fill: "#d4311a", text: "#ffffff" },
};

const FILES = "abcdefgh";

export function moveLabel(before: string, san: string): string {
  return numberMoves(before, [san]);
}

/** The frames for `count` moves from `start`, with review marks where the review still matches. */
export function buildFrames(
  moves: readonly ClipMove[],
  review: GameReview | null,
  start: number,
  count: number,
): MoveFrame[] {
  return moves.slice(start, start + count).map((move, offset) => {
    const ply = start + offset;
    const reviewed = review?.moves[ply];
    const matches = reviewed !== undefined && reviewed.san === move.san;
    const quality = matches ? reviewed.quality : null;
    let note: string | null = null;
    if (matches && quality === "brilliant") {
      note = reviewed.followUp.length > 0 ? `Engine line: ${numberMoves(move.after, reviewed.followUp)}` : null;
    } else if (matches && isError(quality) && reviewed.better) {
      note = `${reviewed.better} was better.`;
    }
    return {
      ply,
      label: moveLabel(move.before, move.san),
      from: move.from,
      to: move.to,
      after: move.after,
      quality,
      note,
    };
  });
}

/** Where the review would centre a clip: two moves before the first brilliant one, or the end. */
export function defaultClipStart(moves: readonly ClipMove[], review: GameReview | null, count: number): number {
  const brilliant = review?.moves.find(
    (move) => move.quality === "brilliant" && moves[move.ply]?.san === move.san,
  );
  if (brilliant) return Math.max(0, brilliant.ply - 2);
  return Math.max(0, moves.length - count);
}

export function fileName(frame: MoveFrame, index: number): string {
  const move = frame.label.replace(/\.+\s*/, "-").replace(/[^A-Za-z0-9=-]+/g, "");
  return `photo-to-chess-${String(index + 1).padStart(2, "0")}-move-${move}.png`;
}

// --- Drawing --------------------------------------------------------------------------------

const sprites = new Map<string, Promise<HTMLCanvasElement>>();

/** The chosen set's artwork, sized for one square and toned down where the board does that too. */
function sprite(set: string, code: PieceCode, size: number): Promise<HTMLCanvasElement> {
  const key = `${set}-${code}-${size}`;
  let cached = sprites.get(key);
  if (!cached) {
    cached = loadSprite(set, code, size);
    cached.catch(() => sprites.delete(key));
    sprites.set(key, cached);
  }
  return cached;
}

async function loadSprite(set: string, code: PieceCode, size: number): Promise<HTMLCanvasElement> {
  const url = pieceUrl(set, code);
  // Some browsers won't draw an SVG with no size of its own, so it's given one.
  const text = (await (await fetch(url)).text()).replace("<svg ", `<svg width="${size}" height="${size}" `);
  const objectUrl = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0, size, size);
    if (pieceSet(set).muted) desaturate(context, size);
    return canvas;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** The same toning as the board's CSS filter for muted sets, saturate(0.15), done by hand. */
function desaturate(context: CanvasRenderingContext2D, size: number) {
  const pixels = context.getImageData(0, 0, size, size);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    data[i] = grey + 0.15 * (r - grey);
    data[i + 1] = grey + 0.15 * (g - grey);
    data[i + 2] = grey + 0.15 * (b - grey);
  }
  context.putImageData(pixels, 0, 0);
}

function squareAt(square: Square, orientation: Color): { x: number; y: number } {
  const file = FILES.indexOf(square[0]!);
  const rank = Number(square[1]) - 1;
  const column = orientation === "w" ? file : 7 - file;
  const row = orientation === "w" ? 7 - rank : rank;
  return { x: BOARD_X + column * SQUARE, y: BOARD_Y + row * SQUARE };
}

function isLight(square: Square): boolean {
  return (FILES.indexOf(square[0]!) + Number(square[1])) % 2 === 0;
}

function allSquares(): Square[] {
  const squares: Square[] = [];
  for (const file of FILES) for (let rank = 1; rank <= 8; rank += 1) squares.push(`${file}${rank}` as Square);
  return squares;
}

/** Shortens text with an ellipsis until it fits. */
function fit(context: CanvasRenderingContext2D, text: string, width: number): string {
  if (context.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

async function drawFrame(
  context: CanvasRenderingContext2D,
  frame: MoveFrame,
  index: number,
  total: number,
  orientation: Color,
  set: string,
) {
  const chess = new Chess(frame.after);

  context.fillStyle = COLORS.background;
  context.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

  context.textBaseline = "alphabetic";
  context.fillStyle = COLORS.text;
  context.font = "600 40px Barlow, sans-serif";
  context.textAlign = "left";
  context.fillText(`Move ${index + 1} of ${total}`, BOARD_X, 80);
  context.fillStyle = COLORS.quiet;
  context.font = "500 30px Barlow, sans-serif";
  context.textAlign = "right";
  context.fillText("Photo to Chess", BOARD_X + BOARD_SIZE, 80);

  for (const square of allSquares()) {
    const { x, y } = squareAt(square, orientation);
    context.fillStyle = isLight(square) ? COLORS.light : COLORS.dark;
    context.fillRect(x, y, SQUARE, SQUARE);
    if (square === frame.from || square === frame.to) {
      context.fillStyle = COLORS.lastMove;
      context.fillRect(x, y, SQUARE, SQUARE);
    }
  }

  if (chess.inCheck()) {
    const king = chess.findPiece({ type: "k", color: chess.turn() })[0];
    if (king) {
      const { x, y } = squareAt(king, orientation);
      const glow = context.createRadialGradient(x + SQUARE / 2, y + SQUARE / 2, 0, x + SQUARE / 2, y + SQUARE / 2, SQUARE * 0.6);
      glow.addColorStop(0, "#e8351c");
      glow.addColorStop(0.35, "rgba(232, 53, 28, 0.75)");
      glow.addColorStop(1, "rgba(232, 53, 28, 0)");
      context.fillStyle = glow;
      context.fillRect(x, y, SQUARE, SQUARE);
    }
  }

  // Coordinates sit inside the edge squares, as on the board on screen.
  context.font = "600 26px Barlow, sans-serif";
  for (const square of allSquares()) {
    const { x, y } = squareAt(square, orientation);
    context.fillStyle = isLight(square) ? COLORS.dark : COLORS.light;
    if (y === BOARD_Y + 7 * SQUARE) {
      context.textAlign = "right";
      context.fillText(square[0]!, x + SQUARE - 8, y + SQUARE - 9);
    }
    if (x === BOARD_X) {
      context.textAlign = "left";
      context.fillText(square[1]!, x + 8, y + 29);
    }
  }

  const pieces = chess.board().flat().filter((piece) => piece !== null);
  const images = await Promise.all(
    pieces.map((piece) => sprite(set, `${piece.color}${piece.type.toUpperCase()}` as PieceCode, SQUARE)),
  );
  pieces.forEach((piece, i) => {
    const { x, y } = squareAt(piece.square, orientation);
    context.drawImage(images[i]!, x, y, SQUARE, SQUARE);
  });

  if (frame.quality) {
    const badge = BADGE[frame.quality];
    const { x, y } = squareAt(frame.to, orientation);
    const cx = x + SQUARE - 14;
    const cy = y + 14;
    context.beginPath();
    context.arc(cx, cy, 30, 0, Math.PI * 2);
    context.fillStyle = badge.fill;
    context.fill();
    context.lineWidth = 4;
    context.strokeStyle = COLORS.background;
    context.stroke();
    context.fillStyle = badge.text;
    context.font = "600 30px Barlow, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(QUALITY_MARK[frame.quality], cx, cy + 1);
    context.textBaseline = "alphabetic";
  }

  context.textAlign = "left";
  context.fillStyle = COLORS.text;
  context.font = "600 64px Barlow, sans-serif";
  context.fillText(frame.label, BOARD_X, 1210);
  if (frame.quality) {
    const width = context.measureText(frame.label).width;
    context.font = "600 44px Barlow, sans-serif";
    context.fillStyle = frame.quality === "inaccuracy" ? "#f8eea3" : BADGE[frame.quality].fill;
    context.fillText(QUALITY_NAME[frame.quality], BOARD_X + width + 28, 1210);
  }
  if (frame.note) {
    context.fillStyle = COLORS.quiet;
    context.font = "400 34px Barlow, sans-serif";
    context.fillText(fit(context, frame.note, BOARD_SIZE), BOARD_X, 1285);
  }
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The image couldn't be made."))), "image/png");
  });
}

/** Draws each frame as a PNG file, in order, with the given piece set. */
export async function renderMoveImages(
  frames: readonly MoveFrame[],
  orientation: Color,
  set: string,
): Promise<File[]> {
  await Promise.all(
    ["600 64px Barlow", "500 30px Barlow", "400 34px Barlow"].map((font) =>
      document.fonts.load(font).catch(() => []),
    ),
  );
  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_WIDTH;
  canvas.height = IMAGE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't draw images.");

  const files: File[] = [];
  for (const [index, frame] of frames.entries()) {
    await drawFrame(context, frame, index, frames.length, orientation, set);
    const blob = await toPng(canvas);
    files.push(new File([blob], fileName(frame, index), { type: "image/png" }));
  }
  return files;
}

// --- Saving ---------------------------------------------------------------------------------

export type SaveOutcome = "shared" | "downloaded" | "cancelled";

/**
 * Hands the files to the phone's share menu, where "Save image" puts them in the photo gallery.
 * Where that menu can't take files, as on most computers, they're downloaded instead.
 * Must be called straight from a tap, or the browser refuses to open the menu.
 */
export async function saveImages(files: readonly File[]): Promise<SaveOutcome> {
  const data = { files: [...files] };
  if (typeof navigator.canShare === "function" && navigator.canShare(data)) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // Any other refusal falls through to downloading.
    }
  }
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return "downloaded";
}
