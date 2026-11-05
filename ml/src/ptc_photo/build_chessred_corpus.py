"""Turns ChessReD2K into a test collection the evaluation tool can read.

Run: python -m ptc_photo.build_chessred_corpus <extracted image folder> corpus/chessred2k

ChessReD is CC BY-NC-SA 4.0, so it's used only to measure accuracy. It must never be trained on,
because the shipped model could then inherit a non-commercial restriction. This writes a manifest
and doesn't copy images: the corpus folder needs the extracted images in place.
"""

import argparse
import json
from collections import Counter
from pathlib import Path

from ptc_data.assets import DATA_DIR
from ptc_vision.board import to_placement

LABELS = {
    "white-pawn": "P",
    "white-rook": "R",
    "white-knight": "N",
    "white-bishop": "B",
    "white-queen": "Q",
    "white-king": "K",
    "black-pawn": "p",
    "black-rook": "r",
    "black-knight": "n",
    "black-bishop": "b",
    "black-queen": "q",
    "black-king": "k",
}
FILES = "abcdefgh"
ALL_SQUARES = [f"{file}{rank}" for rank in "12345678" for file in FILES]


def image_order_corners(corners: dict, width: int, height: int) -> list[dict]:
    """Corners clockwise from the top left as seen in the image, whichever way the board faces."""
    points = [corners[name] for name in ("top_left", "top_right", "bottom_right", "bottom_left")]
    cx = sum(p[0] for p in points) / 4
    cy = sum(p[1] for p in points) / 4
    import math

    ordered = sorted(points, key=lambda p: math.atan2(p[1] - cy, p[0] - cx))
    # atan2 runs clockwise on screen, starting from the left. Rotate to begin nearest the top left.
    start = min(range(4), key=lambda i: ordered[i][0] + ordered[i][1])
    ordered = ordered[start:] + ordered[:start]
    return [
        {"x": min(1.0, max(0.0, p[0] / width)), "y": min(1.0, max(0.0, p[1] / height))}
        for p in ordered
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out", type=Path)
    parser.add_argument(
        "--annotations", type=Path, default=DATA_DIR / "chessred" / "annotations.json"
    )
    args = parser.parse_args()

    data = json.loads(args.annotations.read_text(encoding="utf-8"))
    images = {image["id"]: image for image in data["images"]}
    names = {category["id"]: category["name"] for category in data["categories"]}
    corners = {entry["image_id"]: entry["corners"] for entry in data["annotations"]["corners"]}

    boards: dict[int, dict[str, str]] = {}
    for piece in data["annotations"]["pieces"]:
        if piece["image_id"] not in corners:
            continue
        label = LABELS.get(names[piece["category_id"]])
        position = piece.get("chessboard_position")
        if label and position:
            boards.setdefault(piece["image_id"], {})[position] = label

    entries = []
    counts: Counter = Counter()
    split_info = data["splits"]["chessred2k"]
    for split_name, split in (("dev", "val"), ("holdout", "test")):
        for image_id in split_info[split]["image_ids"]:
            image = images[image_id]
            board = {square: "empty" for square in ALL_SQUARES} | boards.get(image_id, {})
            relative = image["path"].replace("\\", "/")
            if not (args.out / relative).is_file():
                counts["missing image"] += 1
                continue
            entries.append(
                {
                    "id": f"chessred-{image_id}",
                    "image": relative,
                    "kind": "photo",
                    # One physical set, so splits are told apart by game.
                    "set_id": f"chessred-{split_name}",
                    "split": split_name,
                    "source": "ChessReD, Masouris and van Gemert",
                    "license": "CC-BY-NC-SA-4.0, testing only",
                    "placement": to_placement(board),
                    "corners": image_order_corners(
                        corners[image_id], image["width"], image["height"]
                    ),
                    "tags": [f"game:{image['game_id']}", f"camera:{image['camera']}"],
                }
            )
            counts[split_name] += 1

    args.out.mkdir(parents=True, exist_ok=True)
    manifest = args.out / "manifest.jsonl"
    manifest.write_text(
        "\n".join(json.dumps(e) for e in entries) + "\n", encoding="utf-8", newline="\n"
    )
    print(dict(counts))


if __name__ == "__main__":
    main()
