"""Finds flat, axis-aligned chessboards in screenshots.

Squares of alternating colour produce long straight edges at evenly spaced positions, and pieces
can't hide a whole file. So it looks for 7 evenly spaced vertical and horizontal lines, then
confirms each candidate by checking that the squares really alternate between two colours. Square
corners are sampled for that check, because pieces mostly sit in the middle of a square.
"""

from bisect import bisect_left
from dataclasses import dataclass

import cv2
import numpy as np

MIN_CELL = 16
EDGE_THRESHOLDS = (6, 16, 36)
MIN_ALTERNATION = 0.82
MIN_CONTRAST = 14.0
MIN_LINE_SUPPORT = 0.5
SIMILAR_BOARD_AREA = 0.5
MAX_PEAKS = 160
BLUR_VARIANCE = 30.0
BLUR_MIN_SPREAD = 15.0


@dataclass(frozen=True)
class BoardRect:
    x: float
    y: float
    size_x: float
    size_y: float
    score: float

    @property
    def cell(self) -> float:
        return self.size_x / 8

    @property
    def area(self) -> float:
        return self.size_x * self.size_y

    def overlaps(self, other: "BoardRect") -> bool:
        width = min(self.x + self.size_x, other.x + other.size_x) - max(self.x, other.x)
        height = min(self.y + self.size_y, other.y + other.size_y) - max(self.y, other.y)
        return width > 0 and height > 0 and width * height > 0.2 * min(self.area, other.area)


@dataclass(frozen=True)
class GridResult:
    boards: tuple[BoardRect, ...] = ()
    incomplete: bool = False
    blurry: bool = False


def _peaks(profile: np.ndarray, min_height: float) -> list[int]:
    """Positions where the edge count rises sharply above its surroundings."""
    window = 17
    pad = window // 2
    padded = np.pad(profile, pad, mode="edge").astype(np.float32)
    baseline = cv2.blur(padded.reshape(1, -1), (window, 1)).ravel()[pad:-pad]
    prominence = profile - baseline
    found: list[int] = []
    for index in np.flatnonzero(prominence > min_height):
        position = int(index)
        if found and position - found[-1] <= 2:
            if profile[position] > profile[found[-1]]:
                found[-1] = position
        else:
            found.append(position)
    if len(found) > MAX_PEAKS:
        strongest = sorted(found, key=lambda p: -profile[p])[:MAX_PEAKS]
        found = sorted(strongest)
    return found


def _runs(peaks: list[int], min_lines: int, max_cell: float) -> list[tuple[float, float, int]]:
    """Evenly spaced runs of peaks, as (first line, spacing, number of lines)."""
    runs: dict[tuple[int, int], tuple[float, float, int]] = {}
    for i, start in enumerate(peaks):
        for second in peaks[i + 1 :]:
            spacing = second - start
            if spacing < MIN_CELL:
                continue
            if spacing > max_cell:
                break
            tolerance = max(1.6, spacing * 0.02)
            line = [start, second]
            while True:
                # The spacing estimate improves as the run grows, which handles fractional sizes.
                step = (line[-1] - line[0]) / (len(line) - 1)
                target = line[-1] + step
                index = bisect_left(peaks, target)
                near = [peaks[k] for k in (index - 1, index) if 0 <= k < len(peaks)]
                best = min(near, key=lambda p: abs(p - target), default=None)
                if best is None or abs(best - target) > tolerance or best <= line[-1]:
                    break
                line.append(best)
            if len(line) >= min_lines:
                step = (line[-1] - line[0]) / (len(line) - 1)
                key = (line[0], round(step))
                if key not in runs or runs[key][2] < len(line):
                    runs[key] = (float(line[0]), step, len(line))
    return list(runs.values())


def _line_runs(
    gray: np.ndarray, axis: int, min_lines: int, max_cell: float | None = None
) -> list[tuple[float, float, int]]:
    """Runs of evenly spaced lines. Axis 1 finds vertical lines and axis 0 horizontal ones."""
    max_cell = max_cell or gray.shape[axis] / 6
    runs: list[tuple[float, float, int]] = []
    for threshold in EDGE_THRESHOLDS:
        edges = np.abs(np.diff(gray.astype(np.int16), axis=axis)) > threshold
        profile = edges.sum(axis=1 - axis).astype(np.float32)
        runs += _runs(_peaks(profile, max(24.0, MIN_CELL * 2.0)), min_lines, max_cell)
    return runs


def _alternation(
    rgb: np.ndarray, x: float, y: float, cell_x: float, cell_y: float, columns: int, rows: int
) -> tuple[float, float]:
    """How well cells alternate between two colours: (share of cells that fit, colour contrast)."""
    height, width = rgb.shape[:2]
    patch = max(2, round(min(cell_x, cell_y) * 0.12))
    inset = max(1, round(min(cell_x, cell_y) * 0.05))
    colours = np.zeros((rows, columns, 3), dtype=np.float32)
    for row in range(rows):
        for column in range(columns):
            left = round(x + column * cell_x)
            top = round(y + row * cell_y)
            right = round(x + (column + 1) * cell_x)
            bottom = round(y + (row + 1) * cell_y)
            samples = []
            for corner_x in (left + inset, right - inset - patch):
                for corner_y in (top + inset, bottom - inset - patch):
                    x0, y0 = max(0, corner_x), max(0, corner_y)
                    x1, y1 = min(width, corner_x + patch), min(height, corner_y + patch)
                    if x1 > x0 and y1 > y0:
                        samples.append(rgb[y0:y1, x0:x1].reshape(-1, 3))
            if samples:
                colours[row, column] = np.median(np.concatenate(samples), axis=0)

    pattern = np.indices((rows, columns)).sum(axis=0) % 2 == 0
    first = np.median(colours[pattern], axis=0)
    second = np.median(colours[~pattern], axis=0)
    contrast = float(np.linalg.norm(first - second))
    to_first = np.linalg.norm(colours - first, axis=2)
    to_second = np.linalg.norm(colours - second, axis=2)
    fits = np.where(pattern, to_first < to_second, to_second < to_first)
    return float(fits.mean()), contrast


def _line_support(gray: np.ndarray, x: float, y: float, cell_x: float, cell_y: float) -> float:
    """The share of the 14 inner grid lines, within the board itself, that lie on a real edge.

    Lines from something beside the board, such as rows of text, can share its spacing and pass the
    colour check while shifted by part of a square. They won't have edges running across the board.
    """
    height, width = gray.shape
    left, right = max(0, round(x)), min(width, round(x + 8 * cell_x))
    top, bottom = max(0, round(y)), min(height, round(y + 8 * cell_y))
    region = gray.astype(np.int16)
    vertical = np.abs(np.diff(region[top:bottom, left:right], axis=1)) > EDGE_THRESHOLDS[0]
    horizontal = np.abs(np.diff(region[top:bottom, left:right], axis=0)) > EDGE_THRESHOLDS[0]
    totals = []
    for index in range(1, 8):
        # Measured from the board's true origin, which can sit slightly outside the image.
        column = round(x + index * cell_x) - left - 1
        row = round(y + index * cell_y) - top - 1
        if 2 <= column < vertical.shape[1] - 2:
            totals.append(vertical[:, column - 2 : column + 3].any(axis=1).mean())
        if 2 <= row < horizontal.shape[0] - 2:
            totals.append(horizontal[row - 2 : row + 3, :].any(axis=0).mean())
    return float(np.mean(totals)) if totals else 0.0


def _full_candidates(
    rgb: np.ndarray,
    gray: np.ndarray,
    x_runs: list[tuple[float, float, int]],
    y_runs: list[tuple[float, float, int]],
) -> list[BoardRect]:
    height, width = rgb.shape[:2]
    candidates: list[BoardRect] = []
    seen: set[tuple[int, int, int]] = set()
    for x_first, x_step, x_count in x_runs:
        if x_count < 7:
            continue
        for y_first, y_step, y_count in y_runs:
            if y_count < 7 or abs(x_step - y_step) > 0.04 * max(x_step, y_step):
                continue
            # A run of 8 or 9 lines includes the board's outer edges, so every window is tried.
            for x_offset in range(x_count - 6):
                for y_offset in range(y_count - 6):
                    x = x_first + (x_offset - 1) * x_step + 1
                    y = y_first + (y_offset - 1) * y_step + 1
                    key = (round(x / 2), round(y / 2), round(x_step))
                    if key in seen:
                        continue
                    seen.add(key)
                    slack_x = x_step * 0.08
                    slack_y = y_step * 0.08
                    if (
                        x < -slack_x
                        or y < -slack_y
                        or x + 8 * x_step > width + slack_x
                        or y + 8 * y_step > height + slack_y
                    ):
                        continue
                    fit, contrast = _alternation(rgb, x, y, x_step, y_step, 8, 8)
                    if fit < MIN_ALTERNATION or contrast < MIN_CONTRAST:
                        continue
                    support = _line_support(gray, x, y, x_step, y_step)
                    if support >= MIN_LINE_SUPPORT:
                        candidates.append(BoardRect(x, y, 8 * x_step, 8 * y_step, fit * support))
    return candidates


def _looks_incomplete(
    rgb: np.ndarray, x_runs: list[tuple[float, float, int]], y_runs: list[tuple[float, float, int]]
) -> bool:
    """Whether part of a board is visible, running off the edge of the image."""
    height, width = rgb.shape[:2]
    for x_first, x_step, x_count in x_runs:
        for y_first, y_step, y_count in y_runs:
            if abs(x_step - y_step) > 0.04 * max(x_step, y_step):
                continue
            if max(x_count, y_count) < 5 or x_count + y_count < 7:
                continue
            x = max(0.0, x_first - x_step)
            y = max(0.0, y_first - y_step)
            x_end = min(float(width), x_first + x_count * x_step)
            y_end = min(float(height), y_first + y_count * y_step)
            columns = min(8, int((x_end - x) / x_step))
            rows = min(8, int((y_end - y) / y_step))
            if columns < 2 or rows < 2 or columns * rows < 8 or (columns == 8 and rows == 8):
                continue
            # Only a board running off the image counts as cut off.
            margin = max(x_step, y_step) * 1.2
            touches_edge = (
                x < margin or y < margin or x_end > width - margin or y_end > height - margin
            )
            if not touches_edge:
                continue
            fit, contrast = _alternation(rgb, x, y, x_step, y_step, columns, rows)
            if fit >= 0.9 and contrast >= MIN_CONTRAST:
                return True
    return False


def find_boards(rgb: np.ndarray) -> GridResult:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    x_runs = _line_runs(gray, 1, 7)
    y_runs = _line_runs(gray, 0, 7)
    candidates = _full_candidates(rgb, gray, x_runs, y_runs)

    if candidates:
        # Prefer the best fit. Between equal fits prefer the larger, with its outer edges right.
        ordered = sorted(candidates, key=lambda c: (-round(c.score, 3), -c.area))
        kept: list[BoardRect] = []
        for candidate in ordered:
            if not any(candidate.overlaps(other) for other in kept):
                kept.append(candidate)
        largest = max(board.area for board in kept)
        # Small boards next to a main one are usually thumbnails, so they don't count as a second.
        similar = [b for b in kept if b.area >= SIMILAR_BOARD_AREA * largest]
        return GridResult(boards=tuple(sorted(similar, key=lambda b: (b.y, b.x))))

    longest = max(gray.shape) / 6
    if _looks_incomplete(rgb, _line_runs(gray, 1, 2, longest), _line_runs(gray, 0, 2, longest)):
        return GridResult(incomplete=True)

    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    return GridResult(blurry=sharpness < BLUR_VARIANCE and float(gray.std()) > BLUR_MIN_SPREAD)
