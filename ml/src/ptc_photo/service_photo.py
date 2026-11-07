"""Runs the service's photo recogniser through the evaluation tool, with the true corners as taps.

This checks the service's own code, which uses the exported detector rather than PyTorch.
Run with PTC_ORACLE_CORPUS set to the corpus folder, and make_recognizer as the factory.
"""

import hashlib
import json
import os
from pathlib import Path

from ptc_vision.board import parse_placement
from ptc_vision.contract import Point, RecognitionFailure, RecognitionSuccess
from ptc_vision.photo import PhotoRecognizer


class TappedCorners:
    """Stands in for a user tapping the corners: looks up each image's true corners."""

    def __init__(self, corpus: Path):
        self.recognizer = PhotoRecognizer()
        self.corners: dict[str, list[Point]] = {}
        for line in (corpus / "manifest.jsonl").read_text(encoding="utf-8").splitlines():
            entry = json.loads(line)
            digest = hashlib.md5((corpus / entry["image"]).read_bytes()).hexdigest()
            self.corners[digest] = [Point(**c) for c in entry["corners"]]

    def recognize(self, image: bytes) -> RecognitionSuccess | RecognitionFailure:
        return self.recognizer.recognize(image, self.corners[hashlib.md5(image).hexdigest()])


def make_recognizer() -> TappedCorners:
    return TappedCorners(Path(os.environ["PTC_ORACLE_CORPUS"]))


class TappedCornersAndWhite(TappedCorners):
    """Also stands in for the user marking White's side correctly.

    The manifest doesn't record which edge is White's, so each edge is tried and the one that
    gives the true position's orientation is kept, which is what a correct tap would send.
    """

    def __init__(self, corpus: Path):
        super().__init__(corpus)
        self.truth: dict[str, str] = {}
        for line in (corpus / "manifest.jsonl").read_text(encoding="utf-8").splitlines():
            entry = json.loads(line)
            digest = hashlib.md5((corpus / entry["image"]).read_bytes()).hexdigest()
            self.truth[digest] = entry["placement"]

    def recognize(self, image: bytes) -> RecognitionSuccess | RecognitionFailure:
        digest = hashlib.md5(image).hexdigest()
        corners = self.corners[digest]
        truth = parse_placement(self.truth[digest])
        best = None
        for i in range(4):
            a, b = corners[i], corners[(i + 1) % 4]
            white = Point(x=(a.x + b.x) / 2, y=(a.y + b.y) / 2)
            result = self.recognizer.recognize(image, corners, white)
            if not isinstance(result, RecognitionSuccess):
                return result
            board = parse_placement(result.placement)
            right = sum(board[square] == truth[square] for square in truth)
            if best is None or right > best[0]:
                best = (right, result)
        return best[1]


def make_recognizer_with_white() -> TappedCornersAndWhite:
    return TappedCornersAndWhite(Path(os.environ["PTC_ORACLE_CORPUS"]))
