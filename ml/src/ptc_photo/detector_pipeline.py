"""The second candidate: find the corners and each piece, then map each piece's base onto the board.

A piece's base is where it stands, wherever its top leans in the picture. So unlike cropping
squares, this shouldn't mind tall pieces leaning across neighbouring squares at an angle.

Factories for the evaluation tool:
- make_recognizer: the full pipeline
- make_oracle_recognizer: true corners given, which isolates reading pieces from finding the board
"""

import hashlib
import io
import json
import math
import os
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps
from ptc_data.assets import DATA_DIR
from ptc_vision.board import ALL_SQUARES, FILES, to_placement
from ptc_vision.contract import RecognitionFailure, RecognitionSuccess
from ultralytics import YOLO

CORNER_MODEL = DATA_DIR / "runs" / "corners" / "weights" / "best.pt"
PIECE_MODEL = DATA_DIR / "runs" / "pieces" / "weights" / "best.pt"
PIECE_LABELS = "PNBRQKpnbrqk"
IMAGE_SIZE = 640

# How far above the bottom of a piece's box its base centre lies, as a share of the box's height.
# Tuned on the development photos.
BASE_FRACTION = float(os.environ.get("PTC_BASE_FRACTION", "0.05"))
PIECE_CONFIDENCE = float(os.environ.get("PTC_PIECE_CONFIDENCE", "0.25"))
# The rendered set taught the detector the wrong shapes for real pawns, but pawns are still the
# short pieces. A piece below this share of the tallest piece's height, allowing for perspective, is
# called a pawn. Tuned on development photos, all of one chess set, so other sets may differ.
PAWN_HEIGHT_CUT = float(os.environ.get("PTC_PAWN_HEIGHT_CUT", "0.65"))
MAX_PAWNS_PER_SIDE = 8
CORNER_CONFIDENCE = 0.05
REVIEW_BELOW = 0.6


def apply_pawn_height_rule(
    found: dict[tuple[int, int], tuple[float, str, float]],
) -> dict[tuple[int, int], str]:
    """Turns detections into labels, calling short pieces pawns. Kings keep their label."""
    labels = {cell: label for cell, (_, label, _) in found.items()}
    if not found:
        return labels
    tallest = max(height for _, _, height in found.values())
    short: dict[bool, list[tuple[float, tuple[int, int]]]] = {True: [], False: []}
    for cell, (_, label, height) in found.items():
        ratio = height / tallest
        if ratio < PAWN_HEIGHT_CUT and label.upper() != "K":
            short[label.isupper()].append((ratio, cell))
    for white, listed in short.items():
        for _, cell in sorted(listed)[:MAX_PAWNS_PER_SIDE]:
            labels[cell] = "P" if white else "p"
    return labels


def order_clockwise(points: np.ndarray) -> np.ndarray:
    """Orders four points clockwise from the one nearest the top left of the image."""
    centre = points.mean(axis=0)
    ordered = sorted(points.tolist(), key=lambda p: math.atan2(p[1] - centre[1], p[0] - centre[0]))
    start = min(range(4), key=lambda i: ordered[i][0] + ordered[i][1])
    return np.array(ordered[start:] + ordered[:start], dtype=np.float32)


def is_plausible_board(points: np.ndarray) -> bool:
    """Four corners should form a reasonably sized, convex shape."""
    hull = cv2.convexHull(points.astype(np.float32))
    if len(hull) != 4:
        return False
    area = cv2.contourArea(hull)
    span = max(np.ptp(points[:, 0]), np.ptp(points[:, 1]))
    return area > 0.15 * span * span


def choose_corners(boxes: np.ndarray, confidences: np.ndarray) -> np.ndarray | None:
    """Picks the four strongest corners that are well apart and form a plausible board."""
    order = np.argsort(-confidences)
    centres = (boxes[:, :2] + boxes[:, 2:]) / 2
    size = max(np.ptp(centres[:, 0]), np.ptp(centres[:, 1]), 1.0)
    chosen: list[np.ndarray] = []
    for index in order:
        point = centres[index]
        if all(np.linalg.norm(point - other) > 0.1 * size for other in chosen):
            chosen.append(point)
        if len(chosen) == 4:
            break
    if len(chosen) < 4:
        return None
    points = order_clockwise(np.array(chosen))
    return points if is_plausible_board(points) else None


class DetectorRecognizer:
    def __init__(self, corners_by_hash: dict[str, np.ndarray] | None = None):
        self.corners_by_hash = corners_by_hash
        self.corner_model = YOLO(str(CORNER_MODEL)) if corners_by_hash is None else None
        self.piece_model = YOLO(str(PIECE_MODEL))

    def _find_corners(self, rgb: np.ndarray, image: bytes) -> np.ndarray | None:
        height, width = rgb.shape[:2]
        if self.corners_by_hash is not None:
            given = self.corners_by_hash[hashlib.md5(image).hexdigest()]
            return order_clockwise(given * np.array([width, height]))
        result = self.corner_model.predict(
            rgb[..., ::-1], imgsz=IMAGE_SIZE, conf=CORNER_CONFIDENCE, iou=0.3, verbose=False
        )[0]
        if len(result.boxes) < 4:
            return None
        return choose_corners(result.boxes.xyxy.cpu().numpy(), result.boxes.conf.cpu().numpy())

    def recognize(self, image: bytes) -> RecognitionSuccess | RecognitionFailure:
        with Image.open(io.BytesIO(image)) as opened:
            rgb = np.asarray(ImageOps.exif_transpose(opened).convert("RGB"))
        height, width = rgb.shape[:2]

        corners = self._find_corners(rgb, image)
        if corners is None:
            return RecognitionFailure(code="no_board_detected", message="-", retryable=True)

        # The same crop as in training, with room for tall pieces on the far rank.
        side = max(np.ptp(corners[:, 0]), np.ptp(corners[:, 1]))
        margin = side * 0.1
        left = max(0, int(corners[:, 0].min() - margin))
        right = min(width, int(corners[:, 0].max() + margin))
        top = max(0, int(corners[:, 1].min() - margin - side * 0.08))
        bottom = min(height, int(corners[:, 1].max() + margin))
        crop = rgb[top:bottom, left:right]

        result = self.piece_model.predict(
            crop[..., ::-1], imgsz=IMAGE_SIZE, conf=PIECE_CONFIDENCE, iou=0.5, verbose=False
        )[0]

        target = np.array([[0, 0], [8, 0], [8, 8], [0, 8]], dtype=np.float32)
        homography = cv2.getPerspectiveTransform(corners, target)
        inverse = np.linalg.inv(homography)

        best: dict[tuple[int, int], tuple[float, str, float]] = {}
        for box, confidence, cls in zip(
            result.boxes.xyxy.cpu().numpy(),
            result.boxes.conf.cpu().numpy(),
            result.boxes.cls.cpu().numpy().astype(int),
            strict=True,
        ):
            x0, y0, x1, y1 = box
            base_x = (x0 + x1) / 2 + left
            base_y = y1 - BASE_FRACTION * (y1 - y0) + top
            mapped = cv2.perspectiveTransform(
                np.array([[[base_x, base_y]]], dtype=np.float32), homography
            )
            u, v = mapped[0, 0]
            if not (-0.4 <= u < 8.4 and -0.4 <= v < 8.4):
                continue
            cell = (int(np.clip(math.floor(u), 0, 7)), int(np.clip(math.floor(v), 0, 7)))
            if cell not in best or confidence > best[cell][0]:
                # The size of one square at this spot in the picture, which removes perspective.
                around = np.array(
                    [
                        [
                            [u - 0.5, v - 0.5],
                            [u + 0.5, v - 0.5],
                            [u + 0.5, v + 0.5],
                            [u - 0.5, v + 0.5],
                        ]
                    ],
                    dtype=np.float32,
                )
                local = math.sqrt(
                    abs(cv2.contourArea(cv2.perspectiveTransform(around, inverse)[0]))
                )
                best[cell] = (
                    float(confidence),
                    PIECE_LABELS[cls],
                    float(y1 - y0) / max(local, 1.0),
                )

        board = {name: "empty" for name in ALL_SQUARES}
        confidences = {name: 0.95 for name in ALL_SQUARES}
        labels = apply_pawn_height_rule(best)
        for (column, row), (confidence, _, _) in best.items():
            name = f"{FILES[column]}{8 - row}"
            board[name] = labels[(column, row)]
            confidences[name] = confidence

        return RecognitionSuccess(
            source_kind="photo",
            board={
                "corners": [
                    {
                        "x": float(np.clip(p[0] / width, 0, 1)),
                        "y": float(np.clip(p[1] / height, 0, 1)),
                    }
                    for p in corners
                ],
                "confidence": 1.0,
            },
            orientation={
                "quarter_turns_cw": 0,
                "confidence": 0.5,
                "method": "assumed",
                "needs_review": False,
            },
            placement=to_placement(board),
            squares=[
                {
                    "square": s,
                    "label": board[s],
                    "confidence": confidences[s],
                    "needs_review": confidences[s] < REVIEW_BELOW,
                    "review_reasons": ["low_confidence"] if confidences[s] < REVIEW_BELOW else [],
                }
                for s in ALL_SQUARES
            ],
            engine={"name": "detector", "version": "experiment"},
        )


def make_recognizer() -> DetectorRecognizer:
    return DetectorRecognizer()


def make_oracle_recognizer() -> DetectorRecognizer:
    corpus = Path(os.environ["PTC_ORACLE_CORPUS"])
    corners_by_hash = {}
    for line in (corpus / "manifest.jsonl").read_text(encoding="utf-8").splitlines():
        entry = json.loads(line)
        digest = hashlib.md5((corpus / entry["image"]).read_bytes()).hexdigest()
        corners_by_hash[digest] = np.array([[c["x"], c["y"]] for c in entry["corners"]])
    return DetectorRecognizer(corners_by_hash)
