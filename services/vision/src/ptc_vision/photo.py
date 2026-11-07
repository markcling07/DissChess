"""Photo recognition for a board whose four corners the user has tapped.

Each piece is found as a box, and its base, where it stands on the board, is mapped through the
board's perspective onto a square. Tall pieces lean over neighbouring squares in a photo taken at an
angle, but their bases don't.

The detector came from rendered training images, which taught it piece positions well but piece
types less so. Short pieces are therefore called pawns by their height compared with the tallest
piece in the photo. Results are not yet accurate enough for photos to be offered in the app, and
confidences are not calibrated. See docs/photo-comparison.md.
"""

import base64
import json
import math
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

from ptc_vision.board import ALL_SQUARES, Board, to_placement
from ptc_vision.contract import (
    BoardLocation,
    EngineInfo,
    LabelProbability,
    Orientation,
    Point,
    PositionIssue,
    RecognitionFailure,
    RecognitionSuccess,
    ReviewReason,
    SquareResult,
)
from ptc_vision.intake import IntakeError, decode_image
from ptc_vision.orientation import decide_orientation
from ptc_vision.position_checks import check_layout

MODEL_DIR = Path(__file__).parent / "models"
MODEL_PATH = MODEL_DIR / "piece_detector.onnx"
INFO_PATH = MODEL_DIR / "piece_detector.json"
ENGINE_NAME = "photo"
PREVIEW_SIZE = 480
# A tapped board must cover at least this share of the image.
MIN_BOARD_AREA = 0.02
GRID = np.array([[0, 0], [8, 0], [8, 8], [0, 8]], dtype=np.float32)


@dataclass(frozen=True)
class DetectorInfo:
    version: str
    labels: str
    input_size: int
    min_confidence: float
    base_fraction: float
    pawn_height_cut: float
    review_threshold: float
    empty_confidence: float

    @staticmethod
    def load(path: Path) -> "DetectorInfo":
        data = json.loads(path.read_text(encoding="utf-8"))
        return DetectorInfo(**{field: data[field] for field in DetectorInfo.__dataclass_fields__})


@dataclass(frozen=True)
class Detection:
    box: tuple[float, float, float, float]  # x0, y0, x1, y1 in image pixels
    scores: np.ndarray  # one score per label, from the detector, not summing to 1


class PieceDetector:
    """Runs the exported detector: letterboxed input, boxes with a score for each label."""

    def __init__(self, model_path: Path = MODEL_PATH, info_path: Path = INFO_PATH):
        self.info = DetectorInfo.load(info_path)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        self._session = ort.InferenceSession(
            str(model_path), options, providers=["CPUExecutionProvider"]
        )
        self._input = self._session.get_inputs()[0].name

    def detect(self, rgb: np.ndarray) -> list[Detection]:
        size = self.info.input_size
        height, width = rgb.shape[:2]
        scale = size / max(height, width)
        resized = cv2.resize(
            rgb, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_LINEAR
        )
        canvas = np.full((size, size, 3), 114, dtype=np.uint8)
        top = (size - resized.shape[0]) // 2
        left = (size - resized.shape[1]) // 2
        canvas[top : top + resized.shape[0], left : left + resized.shape[1]] = resized
        batch = canvas.transpose(2, 0, 1)[None].astype(np.float32) / 255.0

        output = self._session.run(None, {self._input: batch})[0][0].T  # boxes x (4 + labels)
        scores = output[:, 4:]
        best = scores.max(axis=1)
        keep = best >= self.info.min_confidence
        output, scores, best = output[keep], scores[keep], best[keep]
        if not len(output):
            return []
        cx, cy, w, h = output[:, 0], output[:, 1], output[:, 2], output[:, 3]
        x0 = (cx - w / 2 - left) / scale
        y0 = (cy - h / 2 - top) / scale
        boxes = np.stack([x0, y0, w / scale, h / scale], axis=1)
        chosen = cv2.dnn.NMSBoxes(boxes.tolist(), best.tolist(), self.info.min_confidence, 0.5)
        return [
            Detection(
                box=(
                    float(boxes[i, 0]),
                    float(boxes[i, 1]),
                    float(boxes[i, 0] + boxes[i, 2]),
                    float(boxes[i, 1] + boxes[i, 3]),
                ),
                scores=scores[i],
            )
            for i in np.array(chosen).reshape(-1)
        ]


def order_clockwise(points: np.ndarray) -> np.ndarray:
    """Four points clockwise as seen in the image, starting from the one nearest the top left."""
    centre = points.mean(axis=0)
    ordered = sorted(points.tolist(), key=lambda p: math.atan2(p[1] - centre[1], p[0] - centre[0]))
    start = min(range(4), key=lambda i: ordered[i][0] + ordered[i][1])
    return np.array(ordered[start:] + ordered[:start], dtype=np.float32)


def check_corners(corners: list[Point]) -> str | None:
    """Returns why tapped corners can't be a board, or None when they can."""
    points = order_clockwise(np.array([[p.x, p.y] for p in corners], dtype=np.float32))
    if len(cv2.convexHull(points)) != 4:
        return "The corners don't make a four-sided shape. Tap the board's four corners."
    if cv2.contourArea(points) < MIN_BOARD_AREA:
        return "The corners are too close together. Tap the four corners of the board."
    return None


@dataclass
class _Found:
    confidence: float
    label: str
    scores: np.ndarray
    height: float  # in squares, so perspective doesn't change it


def _local_square_size(inverse: np.ndarray, u: float, v: float) -> float:
    around = np.array(
        [[[u - 0.5, v - 0.5], [u + 0.5, v - 0.5], [u + 0.5, v + 0.5], [u - 0.5, v + 0.5]]],
        dtype=np.float32,
    )
    return math.sqrt(abs(cv2.contourArea(cv2.perspectiveTransform(around, inverse)[0])))


def apply_pawn_height_rule(
    found: dict[tuple[int, int], _Found], cut: float
) -> set[tuple[int, int]]:
    """Calls short pieces pawns, at most eight a side. Returns the cells whose label changed."""
    if not found:
        return set()
    tallest = max(item.height for item in found.values())
    short: dict[bool, list[tuple[float, tuple[int, int]]]] = {True: [], False: []}
    for cell, item in found.items():
        if item.height / tallest < cut and item.label.upper() != "K":
            short[item.label.isupper()].append((item.height / tallest, cell))
    changed = set()
    for white, listed in short.items():
        for _, cell in sorted(listed)[:8]:
            pawn = "P" if white else "p"
            if found[cell].label != pawn:
                found[cell].label = pawn
                changed.add(cell)
    return changed


def best_rotation(grid: list[list[str]]) -> tuple[int, float, bool]:
    """Clockwise quarter turns that put White at the bottom, the confidence, and if it's a guess."""
    results = []
    for turns in range(4):
        # np.rot90 turns anticlockwise, so k anticlockwise turns are (4 - k) clockwise ones.
        rotated = np.rot90(np.array(grid), turns).tolist()
        result = decide_orientation(rotated)
        if result.white_at_bottom:
            results.append((result.confidence, (4 - turns) % 4, result.has_evidence))
    confidence, turns, evidence = max(results) if results else (0.5, 0, False)
    return turns, confidence, evidence


# A cell in the middle of each edge of the grid, in the order of the tapped corners' edges: top,
# right, bottom and left, as seen in the image.
_EDGE_CELLS = ((0, 3), (3, 7), (7, 3), (3, 0))


def turns_for_white_edge(points: np.ndarray, white: np.ndarray) -> int:
    """Clockwise quarter turns that put the edge nearest the given point at the bottom."""
    middles = [(points[i] + points[(i + 1) % 4]) / 2 for i in range(4)]
    edge = min(range(4), key=lambda i: float(np.linalg.norm(middles[i] - white)))
    row, column = _EDGE_CELLS[edge]
    for turns in range(4):
        if _grid_square(row, column, turns)[1] == "1":
            return turns
    raise AssertionError("every edge reaches the bottom within four turns")


def _grid_square(row: int, column: int, turns_cw: int) -> str:
    """The square at a cell of the tapped grid, after turning it so White is at the bottom."""
    for _ in range(turns_cw):
        row, column = column, 7 - row
    return f"{'abcdefgh'[column]}{8 - row}"


class PhotoRecognizer:
    def __init__(self, detector: PieceDetector | None = None):
        self._detector = detector or PieceDetector()

    def recognize(
        self, image: bytes, corners: list[Point], white: Point | None = None
    ) -> RecognitionSuccess | RecognitionFailure:
        """White, when given, is a point on the edge White sits behind, so nothing is guessed."""
        timings: dict[str, float] = {}
        started = time.perf_counter()
        try:
            rgb = decode_image(image)
        except IntakeError as error:
            return error.failure
        height, width = rgb.shape[:2]
        points = order_clockwise(np.array([[p.x * width, p.y * height] for p in corners]))
        timings["decode"] = round((time.perf_counter() - started) * 1000, 2)

        # The training images were cropped like this, with room for tall pieces on the far side.
        side = max(np.ptp(points[:, 0]), np.ptp(points[:, 1]))
        left = max(0, int(points[:, 0].min() - side * 0.1))
        right = min(width, int(points[:, 0].max() + side * 0.1))
        top = max(0, int(points[:, 1].min() - side * 0.18))
        bottom = min(height, int(points[:, 1].max() + side * 0.1))
        detections = self._detector.detect(rgb[top:bottom, left:right])
        timings["detect"] = round((time.perf_counter() - started) * 1000, 2) - timings["decode"]

        homography = cv2.getPerspectiveTransform(points, GRID)
        inverse = np.linalg.inv(homography)
        info = self._detector.info
        found: dict[tuple[int, int], _Found] = {}
        for detection in detections:
            x0, y0, x1, y1 = detection.box
            base = np.array(
                [[[(x0 + x1) / 2 + left, y1 - info.base_fraction * (y1 - y0) + top]]],
                dtype=np.float32,
            )
            u, v = cv2.perspectiveTransform(base, homography)[0, 0]
            if not (-0.4 <= u < 8.4 and -0.4 <= v < 8.4):
                continue
            cell = (int(np.clip(math.floor(v), 0, 7)), int(np.clip(math.floor(u), 0, 7)))
            confidence = float(detection.scores.max())
            if cell in found and found[cell].confidence >= confidence:
                continue
            found[cell] = _Found(
                confidence=confidence,
                label=info.labels[int(detection.scores.argmax())],
                scores=detection.scores,
                height=(y1 - y0) / max(_local_square_size(inverse, u, v), 1.0),
            )
        changed = apply_pawn_height_rule(found, info.pawn_height_cut)

        grid = [
            [
                found[(row, column)].label if (row, column) in found else "empty"
                for column in range(8)
            ]
            for row in range(8)
        ]
        if white is not None:
            turns = turns_for_white_edge(points, np.array([white.x * width, white.y * height]))
            orientation_confidence, has_evidence, method = 1.0, True, "user"
        else:
            turns, orientation_confidence, has_evidence = best_rotation(grid)
            method = "piece_layout" if has_evidence else "assumed"
        board: Board = {}
        results: dict[str, SquareResult] = {}
        for row in range(8):
            for column in range(8):
                square = _grid_square(row, column, turns)
                item = found.get((row, column))
                board[square] = item.label if item else "empty"
                results[square] = self._square_result(square, item, (row, column) in changed)

        issues = check_layout(board)
        for issue in issues:
            for square in issue.squares:
                result = results[square]
                if "position_conflict" not in result.review_reasons:
                    results[square] = result.model_copy(
                        update={
                            "needs_review": True,
                            "review_reasons": [*result.review_reasons, "position_conflict"],
                        }
                    )
        needs_review = not has_evidence or orientation_confidence < 0.97
        if needs_review:
            issues.append(
                PositionIssue(
                    code="orientation_uncertain",
                    severity="warning",
                    message="Check which side is at the bottom of the board.",
                )
            )
        timings["assemble"] = round(
            (time.perf_counter() - started) * 1000 - timings["decode"] - timings["detect"], 2
        )

        return RecognitionSuccess(
            source_kind="photo",
            board=BoardLocation(
                corners=[
                    Point(x=float(p[0] / width), y=float(p[1] / height)) for p in points.tolist()
                ],
                confidence=1.0,
            ),
            orientation=Orientation(
                quarter_turns_cw=turns,
                confidence=orientation_confidence,
                method=method,
                needs_review=needs_review,
            ),
            placement=to_placement(board),
            squares=[results[square] for square in ALL_SQUARES],
            issues=issues,
            rectified_preview=_preview(rgb, points, turns),
            engine=EngineInfo(name=ENGINE_NAME, version=info.version),
            timings_ms=timings,
        )

    def _square_result(self, square: str, item: _Found | None, changed: bool) -> SquareResult:
        info = self._detector.info
        if item is None:
            return SquareResult(
                square=square,
                label="empty",
                confidence=info.empty_confidence,
                alternatives=[],
                needs_review=False,
                review_reasons=[],
            )
        # Detector scores are separate for each label, so they're scaled to share one total.
        share = item.scores / max(float(item.scores.sum()), 1e-6)
        chosen = info.labels.index(item.label)
        confidence = min(item.confidence, float(share[chosen]))
        others = [i for i in np.argsort(share)[::-1] if int(i) != chosen][:3]
        alternatives = [
            LabelProbability(label=info.labels[int(i)], probability=float(share[i]))
            for i in others
            if share[i] >= 0.005
        ]
        confidence = min(confidence, 1.0 - sum(a.probability for a in alternatives))
        reasons: list[ReviewReason] = []
        if confidence < info.review_threshold or changed:
            reasons.append("low_confidence")
        return SquareResult(
            square=square,
            label=item.label,
            confidence=max(confidence, 0.0),
            alternatives=alternatives,
            needs_review=bool(reasons),
            review_reasons=reasons,
        )


def _preview(rgb: np.ndarray, points: np.ndarray, turns_cw: int) -> str | None:
    """The board seen from straight above, turned so White is at the bottom."""
    target = GRID * (PREVIEW_SIZE / 8)
    warp = cv2.getPerspectiveTransform(points, target.astype(np.float32))
    flat = cv2.warpPerspective(rgb, warp, (PREVIEW_SIZE, PREVIEW_SIZE))
    flat = np.rot90(flat, -turns_cw).copy()
    ok, encoded = cv2.imencode(
        ".jpg", cv2.cvtColor(flat, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 80]
    )
    if not ok:
        return None
    return "data:image/jpeg;base64," + base64.b64encode(encoded.tobytes()).decode("ascii")


def make_photo_recognizer() -> PhotoRecognizer | None:
    """None when no detector is installed, in which case the service refuses tapped corners."""
    if not (MODEL_PATH.exists() and INFO_PATH.exists()):
        return None
    return PhotoRecognizer()
