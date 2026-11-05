"""Cuts a located board into square images for the classifier. Training uses this same code."""

import cv2
import numpy as np

TILE_SIZE = 40
LABELS = ("empty", "P", "N", "B", "R", "Q", "K", "p", "n", "b", "r", "q", "k")


def extract_tiles(
    rgb: np.ndarray, x: float, y: float, width: float, height: float, tile_size: int = TILE_SIZE
) -> np.ndarray:
    """Returns 64 tiles as (64, size, size, 3) uint8, row by row from the image's top left."""
    tiles = np.empty((64, tile_size, tile_size, 3), dtype=np.uint8)
    cell_width = width / 8
    cell_height = height / 8
    image_height, image_width = rgb.shape[:2]
    for row in range(8):
        for column in range(8):
            left = int(round(x + column * cell_width))
            right = int(round(x + (column + 1) * cell_width))
            top = int(round(y + row * cell_height))
            bottom = int(round(y + (row + 1) * cell_height))
            left, right = max(0, left), min(image_width, max(right, left + 1))
            top, bottom = max(0, top), min(image_height, max(bottom, top + 1))
            cell = rgb[top:bottom, left:right]
            interpolation = cv2.INTER_AREA if cell.shape[0] >= tile_size else cv2.INTER_LINEAR
            tiles[row * 8 + column] = cv2.resize(
                cell, (tile_size, tile_size), interpolation=interpolation
            )
    return tiles


def to_model_input(tiles: np.ndarray) -> np.ndarray:
    """Converts (n, h, w, 3) uint8 tiles to the model's (n, 3, h, w) float32 input."""
    return np.transpose(tiles.astype(np.float32) / 255.0, (0, 3, 1, 2))
