"""Classifies square images with the exported model. Depends on ONNX Runtime only, not on torch."""

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnxruntime as ort

from ptc_vision.tiles import LABELS, to_model_input

MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_NAME = "square_classifier"


@dataclass(frozen=True)
class ModelInfo:
    version: str
    tile_size: int
    temperature: float
    review_threshold: float


class SquareClassifier:
    def __init__(self, model_dir: Path = MODEL_DIR):
        metadata = json.loads((model_dir / f"{MODEL_NAME}.json").read_text(encoding="utf-8"))
        if tuple(metadata["labels"]) != LABELS:
            raise ValueError("The model's labels don't match this code's labels.")
        self.info = ModelInfo(
            version=metadata["version"],
            tile_size=metadata["tile_size"],
            temperature=metadata["temperature"],
            review_threshold=metadata["review_threshold"],
        )
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        self._session = ort.InferenceSession(
            str(model_dir / f"{MODEL_NAME}.onnx"),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        self._input = self._session.get_inputs()[0].name

    def probabilities(self, tiles: np.ndarray) -> np.ndarray:
        """Calibrated probabilities, shaped (n, labels), for (n, h, w, 3) uint8 tiles."""
        logits = self._session.run(None, {self._input: to_model_input(tiles)})[0]
        scaled = logits / self.info.temperature
        scaled = scaled - scaled.max(axis=1, keepdims=True)
        exponentials = np.exp(scaled)
        return exponentials / exponentials.sum(axis=1, keepdims=True)
