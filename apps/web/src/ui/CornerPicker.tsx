import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  cornerProblem,
  defaultCorners,
  EDGE_NAMES,
  edgeMiddles,
  moveCorner,
  nearestCorner,
  orderClockwise,
  perspective,
  type Corner,
  type Corners,
} from "../recognition/corners";

const NUDGE = 0.005;
const NUDGE_LARGE = 0.02;
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** The eight-by-eight grid the corners imply, drawn so the user can see whether it fits. */
function gridLines(corners: Corners): string[] {
  const map = perspective(orderClockwise(corners));
  const lines: string[] = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    const a = map(t, 0);
    const b = map(t, 1);
    const c = map(0, t);
    const d = map(1, t);
    lines.push(`M${a.x} ${a.y}L${b.x} ${b.y}`, `M${c.x} ${c.y}L${d.x} ${d.y}`);
  }
  return lines;
}

/** Where each edge's White label goes: just outside the board, so it doesn't hide the pieces. */
function sideLabelSpots(ordered: Corners, middles: Corner[]): Corner[] {
  const cx = ordered.reduce((sum, c) => sum + c.x, 0) / 4;
  const cy = ordered.reduce((sum, c) => sum + c.y, 0) / 4;
  const keepIn = (value: number) => Math.min(0.94, Math.max(0.06, value));
  return middles.map((middle) => {
    const dx = middle.x - cx;
    const dy = middle.y - cy;
    const length = Math.hypot(dx, dy) || 1;
    return { x: keepIn(middle.x + (dx / length) * 0.07), y: keepIn(middle.y + (dy / length) * 0.07) };
  });
}

export function CornerPicker({
  imageUrl,
  onSubmit,
  onCancel,
}: {
  imageUrl: string;
  /** White is the middle of the edge White sits behind, or undefined when the user isn't sure. */
  onSubmit: (corners: Corners, white?: Corner) => void;
  onCancel: () => void;
}) {
  const [corners, setCorners] = useState<Corners>(defaultCorners);
  const [dragging, setDragging] = useState<number | null>(null);
  // An edge of the corners in clockwise order, or "guess" when the user doesn't know.
  const [whiteEdge, setWhiteEdge] = useState<number | "guess" | null>(null);
  const [tried, setTried] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const ordered = orderClockwise(corners);
  const middles = edgeMiddles(ordered);
  const labels = sideLabelSpots(ordered, middles);
  const problem =
    cornerProblem(corners) ??
    (whiteEdge === null ? "Tap White on the edge of the board White sits behind, or choose Not sure which side." : null);

  function pointFrom(event: PointerEvent): Corner {
    const box = surface.current!.getBoundingClientRect();
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const point = pointFrom(event);
    const index = nearestCorner(corners, point);
    surface.current?.setPointerCapture(event.pointerId);
    setDragging(index);
    setCorners(moveCorner(corners, index, point));
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragging === null) return;
    setCorners(moveCorner(corners, dragging, pointFrom(event)));
  }

  function onMarkerKey(event: KeyboardEvent, index: number) {
    const step = ARROWS[event.key];
    if (!step) return;
    event.preventDefault();
    const size = event.shiftKey ? NUDGE_LARGE : NUDGE;
    const at = corners[index]!;
    setCorners(moveCorner(corners, index, { x: at.x + step[0] * size, y: at.y + step[1] * size }));
  }

  function submit() {
    setTried(true);
    if (problem) return;
    onSubmit(ordered, typeof whiteEdge === "number" ? middles[whiteEdge] : undefined);
  }

  const outline = ordered.map((c) => `${c.x},${c.y}`).join(" ");
  const whiteLine = typeof whiteEdge === "number" ? [ordered[whiteEdge]!, ordered[(whiteEdge + 1) % 4]!] : null;

  return (
    <div className="corners">
      <h2 className="corners__title">Mark the board's corners</h2>
      <p className="corners__hint" id="corner-hint">
        Drag the four markers onto the corners of the squares, not the frame around them. The grid should line up
        with the board. With a keyboard, focus a marker and use the arrow keys.
      </p>
      <p className="corners__hint">
        Then tap <strong>White</strong> on the edge White sits behind. The app can't always tell from the pieces,
        especially near the end of a game.
      </p>
      <div className="corners__frame">
        <div
          ref={surface}
          className="corners__surface"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => setDragging(null)}
          onPointerCancel={() => setDragging(null)}
        >
          <img className="corners__image" src={imageUrl} alt="The photo of your board" draggable={false} />
          <svg className="corners__overlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
            <polygon className="corners__outline" points={outline} />
            <path className="corners__grid" d={gridLines(corners).join("")} />
            {whiteLine && (
              <line
                className="corners__white-edge"
                x1={whiteLine[0]!.x}
                y1={whiteLine[0]!.y}
                x2={whiteLine[1]!.x}
                y2={whiteLine[1]!.y}
              />
            )}
          </svg>
          {labels.map((spot, index) => (
            <button
              key={`edge-${index}`}
              type="button"
              className={whiteEdge === index ? "corners__side corners__side--chosen" : "corners__side"}
              style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%` }}
              aria-label={`White sits at the ${EDGE_NAMES[index]} edge`}
              aria-pressed={whiteEdge === index}
              // Keeps the surface from moving a corner to this point.
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setWhiteEdge(index)}
            >
              White
            </button>
          ))}
          {corners.map((corner, index) => (
            <button
              key={index}
              type="button"
              className={dragging === index ? "corners__marker corners__marker--active" : "corners__marker"}
              style={{ left: `${corner.x * 100}%`, top: `${corner.y * 100}%` }}
              aria-label={`Corner ${index + 1}`}
              aria-describedby="corner-hint"
              onPointerDown={(event) => {
                // Let the surface handle dragging, but keep the marker focusable for the keyboard.
                event.currentTarget.focus();
              }}
              onKeyDown={(event) => onMarkerKey(event, index)}
            />
          ))}
        </div>
      </div>
      <button
        type="button"
        className="corners__unsure"
        aria-pressed={whiteEdge === "guess"}
        onClick={() => setWhiteEdge("guess")}
      >
        Not sure which side
      </button>
      {tried && problem && (
        <p className="input__problem" role="alert">
          {problem}
        </p>
      )}
      <div className="actions">
        <button type="button" className="primary" onClick={submit}>
          Read board
        </button>
        <button type="button" onClick={() => setCorners(defaultCorners())}>
          Reset corners
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
