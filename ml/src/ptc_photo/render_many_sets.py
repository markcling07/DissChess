"""Renders photo-like training images with every CC0 set listed in render_sets.json.

Run: python -m ptc_photo.render_many_sets --per-set 400

For 3D wooden-board images (coordinates, highlights, arrows, top-down camera):
    python -m ptc_photo.render_many_sets --per-set 400 --style wood3d

Positions are made here, where python-chess is available, and Blender renders them. Images and
labels go to ml/data/many_sets/<split>/, in the same format as chesscog's rendered dataset. Finished
images are skipped, so an interrupted run can be started again.
"""

import argparse
import json
import random
import subprocess
import time
from pathlib import Path

import chess
from ptc_data.assets import DATA_DIR
from ptc_data.render import sample_position

HERE = Path(__file__).parent
SETS = json.loads((HERE / "render_sets.json").read_text(encoding="utf-8"))["sets"]
BLENDER = DATA_DIR / "tools" / "blender-5.2.3-windows-x64" / "blender.exe"
OUT = DATA_DIR / "many_sets"
VAL_SHARE = 0.08


def _sample_highlights(rng: random.Random, placement: dict[str, str]) -> list:
    """Random square highlights like chess apps show for the last move or selection."""
    highlights: list[list[str]] = []
    occupied = [sq for sq, code in placement.items() if code != "empty"]
    all_squares = [f"{f}{r}" for f in "abcdefgh" for r in "12345678"]
    if rng.random() < 0.6:
        colour = rng.choice(["green", "yellow"])
        targets = occupied if len(occupied) >= 2 else all_squares
        for sq in rng.sample(targets, min(2, len(targets))):
            highlights.append([sq, colour])
    if rng.random() < 0.15:
        highlights.append([rng.choice(all_squares), rng.choice(["green", "blue"])])
    if rng.random() < 0.1:
        # Check highlight on a king.
        kings = [sq for sq, code in placement.items() if code in ("K", "k")]
        if kings:
            highlights.append([rng.choice(kings), "red"])
    return highlights


def _sample_arrows(rng: random.Random) -> list:
    """Random analysis arrows between squares."""
    arrows: list[list[str]] = []
    if rng.random() < 0.35:
        colour = rng.choice(["green", "red", "blue", "orange"])
        all_squares = [chess.square_name(s) for s in chess.SQUARES]
        for _ in range(rng.randint(1, 3)):
            a, b = rng.sample(all_squares, 2)
            arrows.append([a, b, colour])
    return arrows


def jobs_for(
    piece_set: dict, count: int, samples: int, style: str = ""
) -> dict[str, dict]:
    rng = random.Random(piece_set["id"] + style)
    by_split: dict[str, dict] = {}
    for index in range(count):
        split = "val" if index >= count * (1 - VAL_SHARE) else "train"
        placement, _ = sample_position(rng)
        occupied = {sq: code for sq, code in placement.items() if code != "empty"}
        style_tag = f"-{style}" if style else ""
        job: dict = {
            "id": f"{piece_set['id']}{style_tag}-{index:05d}",
            "seed": rng.randrange(1 << 30),
            "placement": occupied,
        }
        if style == "wood3d":
            highlights = _sample_highlights(rng, placement)
            if highlights:
                job["highlights"] = highlights
            arrows = _sample_arrows(rng)
            if arrows:
                job["arrows"] = arrows
        by_split.setdefault(
            split,
            {
                "set_id": piece_set["id"],
                "set_file": str(DATA_DIR / "sets" / piece_set["file"]),
                "pieces": piece_set["pieces"],
                "out": str(OUT / split),
                "samples": samples,
                "style": style,
                "images": [],
            },
        )["images"].append(job)
    return by_split


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--per-set", type=int, default=400)
    parser.add_argument("--samples", type=int, default=24)
    parser.add_argument("--only", help="render just this set id")
    parser.add_argument(
        "--style",
        default="",
        help="rendering style: '' for the default, 'wood3d' for wooden boards with coordinates",
    )
    args = parser.parse_args()

    work = OUT / "jobs"
    work.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    for piece_set in SETS:
        if args.only and piece_set["id"] != args.only:
            continue
        for split, jobs in jobs_for(piece_set, args.per_set, args.samples, args.style).items():
            path = work / f"{piece_set['id']}-{split}.json"
            path.write_text(json.dumps(jobs), encoding="utf-8")
            print(f"{piece_set['id']} {split}: {len(jobs['images'])} images", flush=True)
            # Scripts saved inside the downloaded files must never run.
            subprocess.run(
                [
                    str(BLENDER),
                    "--background",
                    "--factory-startup",
                    "--disable-autoexec",
                    "--python",
                    str(HERE / "blender_render.py"),
                    "--",
                    str(path),
                ],
                check=True,
            )
    print(f"Finished in {(time.perf_counter() - started) / 60:.1f} minutes", flush=True)


if __name__ == "__main__":
    main()
