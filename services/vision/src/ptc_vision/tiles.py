"""Cuts a located board into square images for the classifier. Training uses this same code."""

import cv2
import numpy as np

TILE_SIZE = 40
LABELS = ("empty", "P", "N", "B", "R", "Q", "K", "p", "n", "b", "r", "q", "k")


def crop_padded(rgb: np.ndarray, left: int, top: int, right: int, bottom: int) -> np.ndarray:
    """The image between these edges, with any part outside it filled by repeating the edge pixels.

    A board cropped right on its edge can start a little outside the image. Filling the gap keeps
    the edge squares their true shape instead of stretching what's left of them.
    """
    height, width = rgb.shape[:2]
    pad = (max(0, -top), max(0, bottom - height), max(0, -left), max(0, right - width))
    if any(pad):
        rgb = cv2.copyMakeBorder(rgb, *pad, cv2.BORDER_REPLICATE)
        left, right, top, bottom = left + pad[2], right + pad[2], top + pad[0], bottom + pad[0]
    return rgb[top:bottom, left:right]


def extract_tiles(
    rgb: np.ndarray, x: float, y: float, width: float, height: float, tile_size: int = TILE_SIZE
) -> np.ndarray:
    """Returns 64 tiles as (64, size, size, 3) uint8, row by row from the image's top left."""
    tiles = np.empty((64, tile_size, tile_size, 3), dtype=np.uint8)
    cell_width = width / 8
    cell_height = height / 8
    # The whole board at once, so squares past the image's edge are filled rather than stretched.
    board_left, board_top = int(round(x)), int(round(y))
    board = crop_padded(rgb, board_left, board_top, int(round(x + width)), int(round(y + height)))
    for row in range(8):
        for column in range(8):
            left = int(round(x + column * cell_width)) - board_left
            right = max(int(round(x + (column + 1) * cell_width)) - board_left, left + 1)
            top = int(round(y + row * cell_height)) - board_top
            bottom = max(int(round(y + (row + 1) * cell_height)) - board_top, top + 1)
            cell = board[top:bottom, left:right]
            interpolation = cv2.INTER_AREA if cell.shape[0] >= tile_size else cv2.INTER_LINEAR
            tiles[row * 8 + column] = cv2.resize(
                cell, (tile_size, tile_size), interpolation=interpolation
            )
    return tiles


def to_model_input(tiles: np.ndarray) -> np.ndarray:
    """Converts (n, h, w, 3) uint8 tiles to the model's (n, 3, h, w) float32 input."""
    return np.transpose(tiles.astype(np.float32) / 255.0, (0, 3, 1, 2))
