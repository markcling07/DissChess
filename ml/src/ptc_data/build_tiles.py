"""Builds labelled square images for training. Run: python -m ptc_data.build_tiles"""

import argparse
import random
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from ptc_vision.tiles import LABELS, extract_tiles

from ptc_data.assets import DATA_DIR, Split
from ptc_data.render import (
    compose_page,
    jpeg_round_trip,
    render_board,
    sample_position,
    sample_style,
)

LABEL_INDEX = {label: index for index, label in enumerate(LABELS)}
EMPTY_KEEP_RATE = 0.3
FILES = "abcdefgh"


def square_at(row: int, column: int, flipped: bool) -> str:
    file = 7 - column if flipped else column
    rank = row if flipped else 7 - row
    return f"{FILES[file]}{rank + 1}"


def make_board_tiles(args: tuple[Split, int]) -> tuple[np.ndarray, np.ndarray]:
    split, seed = args
    rng = random.Random(seed)
    style = sample_style(rng, split, vary_pieces=split == "train")
    # Small sizes matter: a board in a shared screenshot can be well under 300 pixels.
    size = rng.choice([rng.randint(120, 320), rng.randint(320, 700), rng.randint(700, 1100)])
    position, _ = sample_position(rng)
    render = render_board(rng, style, position, size, rng.random() < 0.3)
    page, (x, y, width, height) = compose_page(rng, render.image)
    if rng.random() < 0.35:
        page = jpeg_round_trip(page, rng.randint(55, 95))

    # The grid finder won't always be pixel perfect, so train with small alignment errors.
    cell = width / 8
    x += rng.uniform(-0.02, 0.02) * cell
    y += rng.uniform(-0.02, 0.02) * cell
    tiles = extract_tiles(np.asarray(page), x, y, width, height)

    kept_tiles = []
    kept_labels = []
    for row in range(8):
        for column in range(8):
            label = render.board[square_at(row, column, render.flipped)]
            if label == "empty" and rng.random() > EMPTY_KEEP_RATE:
                continue
            kept_tiles.append(tiles[row * 8 + column])
            kept_labels.append(LABEL_INDEX[label])
    return np.stack(kept_tiles), np.array(kept_labels, dtype=np.uint8)


def build(split: Split, boards: int, seed: int, out: Path, pool: Pool) -> None:
    results = pool.map(make_board_tiles, [(split, seed + i) for i in range(boards)], chunksize=20)
    tiles = np.concatenate([r[0] for r in results])
    labels = np.concatenate([r[1] for r in results])
    out.mkdir(parents=True, exist_ok=True)
    np.save(out / f"{split}_tiles.npy", tiles)
    np.save(out / f"{split}_labels.npy", labels)
    counts = np.bincount(labels, minlength=len(LABELS))
    print(f"{split}: {len(labels)} tiles from {boards} boards; counts {counts.tolist()}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-boards", type=int, default=8000)
    parser.add_argument("--calibration-boards", type=int, default=800)
    parser.add_argument("--out", type=Path, default=DATA_DIR / "tiles")
    args = parser.parse_args()
    with Pool(12) as pool:
        build("train", args.train_boards, 1_000_000, args.out, pool)
        build("calibration", args.calibration_boards, 2_000_000, args.out, pool)


if __name__ == "__main__":
    main()
