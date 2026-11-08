/** Board corners the user places on a photo, in coordinates from 0 to 1 across the image. */
export type Corner = { readonly x: number; readonly y: number };
export type Corners = readonly [Corner, Corner, Corner, Corner];

/**
 * Photos of real boards are still being trained for and aren't accurate enough to offer. They can
 * be tried by building with VITE_PHOTO_CORNERS=1 or by opening the app with ?photos=1.
 */
export function photosEnabled(search: string = globalThis.location?.search ?? ""): boolean {
  return import.meta.env.VITE_PHOTO_CORNERS === "1" || new URLSearchParams(search).get("photos") === "1";
}

/** Why the screenshot reader can give up on a photo of a real board, where marked corners can help. */
const CORNERS_CAN_HELP: ReadonlySet<string> = new Set([
  "no_board_detected",
  "board_incomplete",
  "multiple_boards_detected",
  "image_too_blurry",
  "recognition_timeout",
]);

export function cornersCanHelp(failureCode: string): boolean {
  return CORNERS_CAN_HELP.has(failureCode);
}

/** A starting rectangle, inset from the edges, for the user to drag onto the board. */
export function defaultCorners(): Corners {
  return [
    { x: 0.15, y: 0.15 },
    { x: 0.85, y: 0.15 },
    { x: 0.85, y: 0.85 },
    { x: 0.15, y: 0.85 },
  ];
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** A corner by position, counting round from any start. */
function at(corners: readonly Corner[], index: number): Corner {
  return corners[((index % 4) + 4) % 4]!;
}

export function moveCorner(corners: Corners, index: number, to: Corner): Corners {
  const next = [...corners] as Corner[];
  next[index] = { x: clamp(to.x), y: clamp(to.y) };
  return next as unknown as Corners;
}

export function nearestCorner(corners: Corners, point: Corner): number {
  let best = 0;
  const distance = (corner: Corner) => Math.hypot(corner.x - point.x, corner.y - point.y);
  corners.forEach((corner, index) => {
    if (distance(corner) < distance(at(corners, best))) best = index;
  });
  return best;
}

/** Clockwise from the corner nearest the top left, as the grid is drawn. Dragging may cross them. */
export function orderClockwise(corners: Corners): Corners {
  const cx = corners.reduce((sum, c) => sum + c.x, 0) / 4;
  const cy = corners.reduce((sum, c) => sum + c.y, 0) / 4;
  const sorted = [...corners].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let start = 0;
  sorted.forEach((corner, index) => {
    const first = at(sorted, start);
    if (corner.x + corner.y < first.x + first.y) start = index;
  });
  return [...sorted.slice(start), ...sorted.slice(0, start)] as unknown as Corners;
}

/** Twice the signed area of the shape, positive when its corners run clockwise in the image. */
function signedArea(corners: Corners): number {
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const a = at(corners, i);
    const b = at(corners, i + 1);
    total += a.x * b.y - b.x * a.y;
  }
  return total;
}

/** Why the corners can't be a board, or null when they can. The service checks this too. */
export function cornerProblem(corners: Corners): string | null {
  const ordered = orderClockwise(corners);
  for (let i = 0; i < 4; i++) {
    const a = at(ordered, i);
    const b = at(ordered, i + 1);
    const c = at(ordered, i + 2);
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0) {
      return "The corners don't make a four-sided shape. Move them onto the board's four corners.";
    }
  }
  if (signedArea(ordered) / 2 < 0.02) return "The corners are too close together. Spread them over the board.";
  return null;
}

/** Names of the edges of corners in clockwise order from the top left, as seen in the photo. */
export const EDGE_NAMES = ["top", "right", "bottom", "left"] as const;

/** The middle of each edge, for corners in clockwise order from the top left. */
export function edgeMiddles(ordered: Corners): Corner[] {
  return [0, 1, 2, 3].map((i) => {
    const a = at(ordered, i);
    const b = at(ordered, i + 1);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  });
}

/** The query string value for the point on White's edge: x,y. */
export function whiteParameter(point: Corner): string {
  return `${point.x.toFixed(4)},${point.y.toFixed(4)}`;
}

/** The query string value the service reads: x1,y1,...,x4,y4. */
export function cornersParameter(corners: Corners): string {
  return corners.flatMap((corner) => [corner.x.toFixed(4), corner.y.toFixed(4)]).join(",");
}

type Matrix = readonly number[];

/** The perspective map taking the unit square's corners to these four, clockwise from the top left. */
export function perspective(corners: Corners): (u: number, v: number) => Corner {
  const source: readonly (readonly [number, number])[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  // Eight equations in the eight unknowns of a homography with its last entry fixed at 1.
  const rows: number[][] = [];
  source.forEach(([u, v], i) => {
    const { x, y } = at(corners, i);
    rows.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    rows.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  });
  const [h0, h1, h2, h3, h4, h5, h6, h7] = solve(rows) as [number, number, number, number, number, number, number, number];
  return (u, v) => {
    const w = h6 * u + h7 * v + 1;
    return { x: (h0 * u + h1 * v + h2) / w, y: (h3 * u + h4 * v + h5) / w };
  };
}

/** Gauss-Jordan elimination with partial pivoting, on rows of coefficients then the result. */
function solve(input: readonly number[][]): Matrix {
  const rows = input.map((row) => [...row]);
  const n = rows.length;
  const cell = (row: number, column: number) => rows[row]![column]!;
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) {
      if (Math.abs(cell(row, column)) > Math.abs(cell(pivot, column))) pivot = row;
    }
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];
    const lead = cell(column, column) || 1e-12;
    for (let row = 0; row < n; row++) {
      if (row === column) continue;
      const factor = cell(row, column) / lead;
      for (let k = column; k <= n; k++) rows[row]![k] = cell(row, k) - factor * cell(column, k);
    }
  }
  return rows.map((row, i) => row[n]! / (row[i] || 1e-12));
}
