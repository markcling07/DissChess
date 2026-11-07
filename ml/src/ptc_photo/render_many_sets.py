"""Renders photo-like training images with every CC0 set listed in render_sets.json.

Run: python -m ptc_photo.render_many_sets --per-set 400

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

from ptc_data.assets import DATA_DIR
from ptc_data.render import sample_position

HERE = Path(__file__).parent
SETS = json.loads((HERE / "render_sets.json").read_text(encoding="utf-8"))["sets"]
BLENDER = DATA_DIR / "tools" / "blender-5.2.3-windows-x64" / "blender.exe"
OUT = DATA_DIR / "many_sets"
VAL_SHARE = 0.08


def jobs_for(piece_set: dict, count: int, samples: int) -> dict[str, dict]:
    rng = random.Random(piece_set["id"])
    by_split: dict[str, dict] = {}
    for index in range(count):
        split = "val" if index >= count * (1 - VAL_SHARE) else "train"
        placement, _ = sample_position(rng)
        job = {
            "id": f"{piece_set['id']}-{index:05d}",
            "seed": rng.randrange(1 << 30),
            "placement": {square: code for square, code in placement.items() if code != "empty"},
        }
        by_split.setdefault(
            split,
            {
                "set_id": piece_set["id"],
                "set_file": str(DATA_DIR / "sets" / piece_set["file"]),
                "pieces": piece_set["pieces"],
                "out": str(OUT / split),
                "samples": samples,
                "images": [],
            },
        )["images"].append(job)
    return by_split


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--per-set", type=int, default=400)
    parser.add_argument("--samples", type=int, default=24)
    parser.add_argument("--only", help="render just this set id")
    args = parser.parse_args()

    work = OUT / "jobs"
    work.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    for piece_set in SETS:
        if args.only and piece_set["id"] != args.only:
            continue
        for split, jobs in jobs_for(piece_set, args.per_set, args.samples).items():
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
