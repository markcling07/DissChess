import { describe, expect, it } from "vitest";
import {
  cornerProblem,
  cornersCanHelp,
  cornersParameter,
  defaultCorners,
  edgeMiddles,
  moveCorner,
  nearestCorner,
  orderClockwise,
  perspective,
  photosEnabled,
  whiteParameter,
  type Corners,
} from "./corners";

const square: Corners = [
  { x: 0.2, y: 0.2 },
  { x: 0.8, y: 0.2 },
  { x: 0.8, y: 0.8 },
  { x: 0.2, y: 0.8 },
];

describe("tapped corners", () => {
  it("are offered only when switched on", () => {
    expect(photosEnabled("")).toBe(false);
    expect(photosEnabled("?photos=1")).toBe(true);
    expect(photosEnabled("?photos=0")).toBe(false);
  });

  it("start as an inset rectangle that makes a board", () => {
    expect(cornerProblem(defaultCorners())).toBeNull();
  });

  it("move the nearest corner, and stay inside the image", () => {
    expect(nearestCorner(square, { x: 0.9, y: 0.9 })).toBe(2);
    const moved = moveCorner(square, 2, { x: 1.4, y: -0.2 });
    expect(moved[2]).toEqual({ x: 1, y: 0 });
    expect(square[2]).toEqual({ x: 0.8, y: 0.8 });
  });

  it("are put back in clockwise order after being dragged past each other", () => {
    const crossed: Corners = [square[2], square[0], square[3], square[1]];
    expect(orderClockwise(crossed)).toEqual(square);
  });

  it("must make a four-sided shape of a reasonable size", () => {
    const dent: Corners = [square[0], square[1], { x: 0.5, y: 0.3 }, square[3]];
    expect(cornerProblem(dent)).toMatch(/four-sided/);
    const tiny: Corners = [
      { x: 0.5, y: 0.5 },
      { x: 0.55, y: 0.5 },
      { x: 0.55, y: 0.55 },
      { x: 0.5, y: 0.55 },
    ];
    expect(cornerProblem(tiny)).toMatch(/too close/);
  });

  it("are sent as eight numbers", () => {
    expect(cornersParameter(square)).toBe("0.2000,0.2000,0.8000,0.2000,0.8000,0.8000,0.2000,0.8000");
  });

  it("give a grid that follows the board's perspective", () => {
    // A board seen at an angle: the far edge is shorter than the near one.
    const tilted: Corners = [
      { x: 0.3, y: 0.2 },
      { x: 0.7, y: 0.2 },
      { x: 0.9, y: 0.8 },
      { x: 0.1, y: 0.8 },
    ];
    const map = perspective(tilted);
    expect(map(0, 0).x).toBeCloseTo(0.3);
    expect(map(1, 1).x).toBeCloseTo(0.9);
    // The middle rank line sits nearer the far edge than halfway, as squares shrink with distance.
    const middle = map(0.5, 0.5);
    expect(middle.x).toBeCloseTo(0.5);
    expect(middle.y).toBeLessThan(0.5);
  });
});

describe("White's side", () => {
  it("finds the middle of each edge, top first then clockwise", () => {
    const square = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ] as const;
    const middles = edgeMiddles(square).map(({ x, y }) => [Number(x.toFixed(2)), Number(y.toFixed(2))]);
    expect(middles).toEqual([
      [0.5, 0.2],
      [0.8, 0.5],
      [0.5, 0.8],
      [0.2, 0.5],
    ]);
  });

  it("writes the point as the service reads it", () => {
    expect(whiteParameter({ x: 0.5, y: 0.85 })).toBe("0.5000,0.8500");
  });
});

describe("offering to mark corners", () => {
  it.each(["no_board_detected", "board_incomplete", "multiple_boards_detected", "image_too_blurry", "recognition_timeout"])(
    "helps after %s",
    (code) => expect(cornersCanHelp(code)).toBe(true),
  );

  it.each(["file_too_large", "unsupported_media_type", "internal_error"])("doesn't help after %s", (code) =>
    expect(cornersCanHelp(code)).toBe(false),
  );
});
