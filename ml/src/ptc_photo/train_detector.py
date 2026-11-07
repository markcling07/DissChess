"""Trains the corner finder or the piece detector on the rendered dataset.

Run: python -m ptc_photo.train_detector pieces --epochs 30

Only data that can ship goes in here. ChessReD is for testing only and must never be added.
"""

import argparse
import time

from ptc_data.assets import DATA_DIR
from ultralytics import YOLO, settings

SETTINGS = {
    # All renders share one chess set, so strong colour changes stand in for other materials.
    "pieces": {
        "degrees": 6.0,
        "perspective": 0.0005,
        "hsv_h": 0.05,
        "hsv_s": 0.8,
        "hsv_v": 0.5,
        "scale": 0.35,
        "fliplr": 0.5,
        "mosaic": 0.5,
    },
    # Many chess sets: the same settings as pieces, on the dataset from build_many_sets_yolo.
    "mixed": None,
    # Boards are often seen from a corner, so corners get large rotations. Pieces don't, since
    # pieces stay upright in a photo however the board is turned.
    "corners": {
        "degrees": 45.0,
        "perspective": 0.001,
        "hsv_h": 0.05,
        "hsv_s": 0.8,
        "hsv_v": 0.5,
        "scale": 0.5,
        "fliplr": 0.5,
        "mosaic": 0.3,
    },
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", choices=sorted(SETTINGS))
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--fraction", type=float, default=1.0)
    parser.add_argument("--name", default=None)
    parser.add_argument("--weights", default="yolo11n.pt", help="starting weights in ml/data")
    args = parser.parse_args()

    settings.update({"sync": False})
    started = time.perf_counter()
    # Kept with the other data, as the library would otherwise download into the current folder.
    model = YOLO(str(DATA_DIR / args.weights))
    model.train(
        data=str(DATA_DIR / f"yolo_{args.target}" / "dataset.yaml"),
        epochs=args.epochs,
        batch=args.batch,
        imgsz=args.imgsz,
        fraction=args.fraction,
        device="cpu",
        workers=4,
        project=str(DATA_DIR / "runs"),
        name=args.name or args.target,
        exist_ok=True,
        patience=8,
        verbose=False,
        plots=False,
        **(SETTINGS[args.target] or SETTINGS["pieces"]),
    )
    print(f"Finished {args.target} in {(time.perf_counter() - started) / 60:.1f} minutes")


if __name__ == "__main__":
    main()
