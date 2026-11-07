"""Builds the piece detector's training set from the many-set renders plus some of chesscog's.

Run after render_many_sets and build_rendered_yolo:
    python -m ptc_photo.build_many_sets_yolo --chesscog 1200

The many-set renders are cropped to the board the same way as chesscog's. The dataset lists images
from both folders, so chesscog's crops aren't copied again. Its single set is limited to a share,
so that no one set's shapes dominate.
"""

import argparse
import json
import random
from multiprocessing import Pool
from pathlib import Path

from PIL import Image
from ptc_data.assets import DATA_DIR

from ptc_photo.build_rendered_yolo import OUT_PIECES, PIECE_CLASSES, write_piece_crop

RENDERS = DATA_DIR / "many_sets"
OUT = DATA_DIR / "yolo_many_sets"
MIXED = DATA_DIR / "yolo_mixed"


def convert(job: tuple[str, str]) -> None:
    path, split = job
    image_path = Path(path)
    label = json.loads(image_path.with_suffix(".json").read_text(encoding="utf-8"))
    with Image.open(image_path) as opened:
        image = opened.convert("RGB")
    write_piece_crop(image, label, image_path.stem, OUT, split, random.Random(image_path.stem))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--chesscog", type=int, default=1200, help="chesscog training images to mix in"
    )
    args = parser.parse_args()

    for kind in ("images", "labels"):
        for split in ("train", "val"):
            (OUT / kind / split).mkdir(parents=True, exist_ok=True)
    jobs = [
        (str(path), split)
        for split in ("train", "val")
        for path in sorted((RENDERS / split).glob("*.jpg"))
        if path.with_suffix(".json").exists()
    ]
    with Pool(8) as pool:
        for _ in pool.imap_unordered(convert, jobs, chunksize=8):
            pass
    print(f"converted {len(jobs)} many-set renders", flush=True)

    MIXED.mkdir(parents=True, exist_ok=True)
    rng = random.Random(0)
    chesscog_train = sorted((OUT_PIECES / "images" / "train").glob("*.jpg"))
    rng.shuffle(chesscog_train)
    lists = {
        "train": sorted((OUT / "images" / "train").glob("*.jpg")) + chesscog_train[: args.chesscog],
        "val": sorted((OUT / "images" / "val").glob("*.jpg"))
        + sorted((OUT_PIECES / "images" / "val").glob("*.jpg"))[:100],
    }
    for split, paths in lists.items():
        (MIXED / f"{split}.txt").write_text(
            "\n".join(p.as_posix() for p in paths) + "\n", encoding="utf-8", newline="\n"
        )
        print(f"{split}: {len(paths)} images", flush=True)
    names = "\n".join(f"  {i}: {name}" for i, name in enumerate(PIECE_CLASSES))
    (MIXED / "dataset.yaml").write_text(
        f"path: {MIXED.as_posix()}\ntrain: train.txt\nval: val.txt\nnames:\n{names}\n",
        encoding="utf-8",
        newline="\n",
    )


if __name__ == "__main__":
    main()
