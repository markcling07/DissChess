"""Runs chesscog (MIT licence) as published, as a baseline to compare against.

Its pretrained models were trained on rendered images (CC BY 4.0). They're saved as full pickled
objects, and unpickling can run code, so only an explicit list of classes is allowed to load. Those
classes were checked against the files without loading them.

Two factories are offered for the evaluation tool:
- make_recognizer: the full pipeline, which finds the board itself
- make_oracle_recognizer: the true corners are given, which isolates how well it reads pieces
"""

import hashlib
import io
import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image
from ptc_data.assets import DATA_DIR
from ptc_vision.board import ALL_SQUARES, parse_placement, to_placement
from ptc_vision.contract import RecognitionFailure, RecognitionSuccess

ROOT = DATA_DIR / "chesscog"
MODELS = ROOT / "models"
LONGEST_EDGE = 1200


def _patch_for_current_libraries(detect_corners) -> None:
    """Adapts two calls chesscog makes to libraries that have since changed. Its logic is untouched.

    Its angle metric returns one-item arrays, which NumPy 2 won't store as numbers. scikit-learn
    also renamed the `affinity` setting to `metric`.
    """
    from sklearn.cluster import AgglomerativeClustering

    def pairwise_distances(x, y, metric):
        return metric(x, y.T)

    def agglomerative(n_clusters, affinity, linkage):
        return AgglomerativeClustering(n_clusters=n_clusters, metric=affinity, linkage=linkage)

    detect_corners.pairwise_distances = pairwise_distances
    detect_corners.AgglomerativeClustering = agglomerative


def _import_chesscog():
    from ptc_photo import recap_shim

    recap_shim.install()
    source = str(ROOT / "src")
    if source not in sys.path:
        sys.path.insert(0, source)
    os.environ.setdefault("MODELS_DIR", str(MODELS))
    from chesscog import corner_detection, occupancy_classifier, piece_classifier  # noqa: F401
    from chesscog.corner_detection import detect_corners

    _patch_for_current_libraries(detect_corners)
    from chesscog.core.dataset import build_transforms, name_to_piece
    from chesscog.core.dataset.datasets import Datasets
    from chesscog.core.exceptions import ChessboardNotLocatedException
    from chesscog.occupancy_classifier import create_dataset as occupancy_data
    from chesscog.occupancy_classifier.models import ResNet as OccupancyResNet
    from chesscog.piece_classifier import create_dataset as piece_data
    from chesscog.piece_classifier.models import InceptionV3 as PieceInception
    from recap import CfgNode

    return {
        "find_corners": corner_detection.find_corners,
        "resize_image": corner_detection.resize_image,
        "build_transforms": build_transforms,
        "name_to_piece": name_to_piece,
        "Datasets": Datasets,
        "NotLocated": ChessboardNotLocatedException,
        "occupancy_data": occupancy_data,
        "piece_data": piece_data,
        "CfgNode": CfgNode,
        "safe_classes": [OccupancyResNet, PieceInception],
    }


def _load_model(path: Path, extra: list) -> torch.nn.Module:
    import collections

    from torch import nn
    from torch._utils import _rebuild_parameter, _rebuild_tensor_v2
    from torch.nn.modules import activation, batchnorm, container, conv, dropout, linear, pooling
    from torchvision.models import inception, resnet

    allowed = [
        *extra,
        set,
        collections.OrderedDict,
        _rebuild_parameter,
        _rebuild_tensor_v2,
        torch.FloatStorage,
        torch.LongStorage,
        activation.ReLU,
        batchnorm.BatchNorm2d,
        container.Sequential,
        conv.Conv2d,
        dropout.Dropout,
        linear.Linear,
        pooling.AdaptiveAvgPool2d,
        pooling.MaxPool2d,
        resnet.BasicBlock,
        resnet.ResNet,
        inception.BasicConv2d,
        inception.Inception3,
        inception.InceptionA,
        inception.InceptionAux,
        inception.InceptionB,
        inception.InceptionC,
        inception.InceptionD,
        inception.InceptionE,
        nn.Module,
    ]
    with torch.serialization.safe_globals(allowed):
        model = torch.load(path, map_location="cpu", weights_only=True)
    model.eval()
    return model


class ChesscogRecognizer:
    def __init__(self, corners_by_hash: dict[str, np.ndarray] | None = None):
        self.lib = _import_chesscog()
        cfg_node = self.lib["CfgNode"]
        self.corner_cfg = cfg_node.load_yaml_with_base(
            str(ROOT / "src" / "config" / "corner_detection.yaml")
        )
        self.occupancy_cfg = cfg_node.load_yaml_with_base(str(MODELS / "ResNet.yaml"))
        self.piece_cfg = cfg_node.load_yaml_with_base(str(MODELS / "InceptionV3.yaml"))
        safe = self.lib["safe_classes"]
        self.occupancy = _load_model(MODELS / "ResNet.pt", safe)
        self.pieces = _load_model(MODELS / "InceptionV3.pt", safe)
        test = self.lib["Datasets"].TEST
        self.occupancy_tf = self.lib["build_transforms"](self.occupancy_cfg, mode=test)
        self.piece_tf = self.lib["build_transforms"](self.piece_cfg, mode=test)
        self.piece_classes = [self.lib["name_to_piece"](n) for n in self.piece_cfg.DATASET.CLASSES]
        self.occupied_index = self.occupancy_cfg.DATASET.CLASSES.index("occupied")
        self.corners_by_hash = corners_by_hash

    def recognize(self, image: bytes) -> RecognitionSuccess | RecognitionFailure:
        import chess

        with Image.open(io.BytesIO(image)) as opened:
            rgb = np.asarray(opened.convert("RGB"))
        given = None
        if self.corners_by_hash is not None:
            given = self.corners_by_hash[hashlib.md5(image).hexdigest()] * np.array(
                [rgb.shape[1], rgb.shape[0]]
            )

        with torch.no_grad():
            small, scale = self.lib["resize_image"](self.corner_cfg, rgb)
            try:
                corners = (
                    np.array(given, dtype=np.float32) * scale
                    if given is not None
                    else self.lib["find_corners"](self.corner_cfg, small)
                )
            except self.lib["NotLocated"]:
                # Only its own "not found" is a refusal. Anything else is left to surface as a
                # crash, so a bug can't pass for a board that wasn't found.
                return RecognitionFailure(code="no_board_detected", message="-", retryable=True)

            if given is not None:
                from chesscog.core import sort_corner_points

                corners = sort_corner_points(corners)

            squares = list(chess.SQUARES)
            warped = self.lib["occupancy_data"].warp_chessboard_image(small, corners)
            crops = [
                self.occupancy_tf(
                    Image.fromarray(self.lib["occupancy_data"].crop_square(warped, sq, chess.WHITE))
                )
                for sq in squares
            ]
            occupied = (
                self.occupancy(torch.stack(crops)).argmax(dim=-1) == self.occupied_index
            ).numpy()

            board = {name: "empty" for name in ALL_SQUARES}
            indexes = [i for i, flag in enumerate(occupied) if flag]
            if indexes:
                warped = self.lib["piece_data"].warp_chessboard_image(small, corners)
                piece_crops = [
                    self.piece_tf(
                        Image.fromarray(
                            self.lib["piece_data"].crop_square(warped, squares[i], chess.WHITE)
                        )
                    )
                    for i in indexes
                ]
                predicted = self.pieces(torch.stack(piece_crops)).argmax(dim=-1).numpy()
                for index, label in zip(indexes, predicted, strict=True):
                    name = chess.square_name(squares[index])
                    board[name] = self.piece_classes[int(label)].symbol()

        h, w = small.shape[:2]
        points = corners / np.array([w, h])
        return _baseline_success(board, points)


def _baseline_success(board: dict, points: np.ndarray) -> RecognitionSuccess:
    """Wraps a result in the contract. This baseline gives no confidence, so none is claimed."""
    return RecognitionSuccess(
        source_kind="photo",
        board={
            "corners": [
                {"x": float(np.clip(p[0], 0, 1)), "y": float(np.clip(p[1], 0, 1))} for p in points
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
            {"square": s, "label": board[s], "confidence": 1.0, "needs_review": False}
            for s in ALL_SQUARES
        ],
        engine={"name": "chesscog-baseline", "version": "0.1.0"},
    )


def make_recognizer() -> ChesscogRecognizer:
    return ChesscogRecognizer()


def make_oracle_recognizer() -> ChesscogRecognizer:
    corpus = Path(os.environ["PTC_ORACLE_CORPUS"])
    corners_by_hash = {}
    for line in (corpus / "manifest.jsonl").read_text(encoding="utf-8").splitlines():
        entry = json.loads(line)
        digest = hashlib.md5((corpus / entry["image"]).read_bytes()).hexdigest()
        corners_by_hash[digest] = np.array([[c["x"], c["y"]] for c in entry["corners"]])
    return ChesscogRecognizer(corners_by_hash)


__all__ = ["make_oracle_recognizer", "make_recognizer", "cv2", "parse_placement"]
