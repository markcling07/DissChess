"""Converts chesscog's rendered dataset (CC BY 4.0) into two detector training sets.

Run: python -m ptc_photo.build_rendered_yolo

- corners: whole images, with each board corner as a separate object. Which corner is which is
  worked out from geometry afterwards, because any fixed order becomes unstable when a board is seen
  from one of its corners and appears as a diamond.
- pieces: images cropped to the board, as the pipeline does, so that pieces fill more of the frame.

Images are read directly from the archives and shrunk, which saves the 15 GB that unpacking would
take. train.z01 and train.zip are one split archive, which Python's zipfile can't read.
"""

import argparse
import io
import json
import random
import struct
import zlib
from collections.abc import Iterator
from multiprocessing import Pool
from pathlib import Path

from PIL import Image
from ptc_data.assets import DATA_DIR

RAW = DATA_DIR / "rendered"
OUT_PIECES = DATA_DIR / "yolo_pieces"
OUT_CORNERS = DATA_DIR / "yolo_corners"
IMAGE_SIZE = 800
PIECE_CLASSES = "PNBRQKpnbrqk"
CORNER_BOX_FRACTION = 0.05

EOCD = b"PK\x05\x06"


class SplitArchive:
    """Reads members of a zip that may be split across several files, as one continuous stream."""

    def __init__(self, parts: list[Path]):
        self.parts = parts
        self.starts = []
        total = 0
        for part in parts:
            self.starts.append(total)
            total += part.stat().st_size
        with parts[-1].open("rb") as file:
            size = parts[-1].stat().st_size
            file.seek(max(0, size - (1 << 17)))
            tail = file.read()
        at = tail.rfind(EOCD)
        if at < 0:
            raise ValueError(f"No end of archive record in {parts[-1]}")
        (_, _, cd_disk, _, count, cd_size, cd_offset, _) = struct.unpack(
            "<4sHHHHIIH", tail[at : at + 22]
        )
        with parts[cd_disk].open("rb") as file:
            file.seek(cd_offset)
            directory = file.read(cd_size)
        self.members: dict[str, tuple[int, int, int]] = {}
        position = 0
        for _ in range(count):
            fields = struct.unpack("<4sHHHHHHIIIHHHHHII", directory[position : position + 46])
            method = fields[4]
            compressed = fields[8]
            name_length, extra_length, comment_length = fields[10], fields[11], fields[12]
            disk = fields[13]
            offset = fields[16]
            name = directory[position + 46 : position + 46 + name_length].decode("utf-8")
            position += 46 + name_length + extra_length + comment_length
            if not name.endswith("/") and "__MACOSX" not in name:
                self.members[name] = (self.starts[disk] + offset, compressed, method)

    def _read_at(self, start: int, length: int) -> bytes:
        result = bytearray()
        for index, part in enumerate(self.parts):
            part_start = self.starts[index]
            part_size = part.stat().st_size
            if start >= part_start + part_size or start + length <= part_start:
                continue
            with part.open("rb") as file:
                file.seek(max(0, start - part_start))
                result += file.read(
                    min(length - len(result), part_start + part_size - max(start, part_start))
                )
        return bytes(result)

    def read(self, name: str) -> bytes:
        start, compressed, method = self.members[name]
        header = self._read_at(start, 30)
        name_length, extra_length = struct.unpack("<HH", header[26:30])
        data = self._read_at(start + 30 + name_length + extra_length, compressed)
        return zlib.decompress(data, -15) if method == 8 else data


def corner_labels(corners: list, width: int, height: int) -> list[str]:
    box = CORNER_BOX_FRACTION
    rows = []
    for x, y in corners:
        rows.append(
            f"0 {min(1, max(0, x / width)):.5f} {min(1, max(0, y / height)):.5f} "
            f"{box:.5f} {box * width / height:.5f}"
        )
    return rows


def convert(job: tuple) -> str | None:
    parts, name, split = job
    archive = _archive(parts)
    stem = Path(name).stem
    label = json.loads(archive.read(f"{name.rsplit('.', 1)[0]}.json"))
    with Image.open(io.BytesIO(archive.read(name))) as opened:
        image = opened.convert("RGB")
    width, height = image.size
    rng = random.Random(stem)

    scale = IMAGE_SIZE / max(width, height)
    full = image.resize((round(width * scale), round(height * scale)), Image.LANCZOS)
    full.save(OUT_CORNERS / "images" / split / f"{stem}.jpg", quality=88)
    (OUT_CORNERS / "labels" / split / f"{stem}.txt").write_text(
        "\n".join(corner_labels(label["corners"], width, height)) + "\n", encoding="utf-8"
    )

    xs = [c[0] for c in label["corners"]]
    ys = [c[1] for c in label["corners"]]
    side = max(max(xs) - min(xs), max(ys) - min(ys))
    margin = side * rng.uniform(0.05, 0.14)
    # Tall pieces on the back rank stick up past the board's top edge.
    left = max(0, min(xs) - margin)
    right = min(width, max(xs) + margin)
    top = max(0, min(ys) - margin - side * 0.08)
    bottom = min(height, max(ys) + margin)
    crop = image.crop((round(left), round(top), round(right), round(bottom)))
    crop_width, crop_height = crop.size
    crop_scale = IMAGE_SIZE / max(crop_width, crop_height)
    crop.resize(
        (round(crop_width * crop_scale), round(crop_height * crop_scale)), Image.LANCZOS
    ).save(OUT_PIECES / "images" / split / f"{stem}.jpg", quality=88)

    rows = []
    for piece in label["pieces"]:
        x, y, w, h = piece["box"]
        x0, y0 = max(left, x), max(top, y)
        x1, y1 = min(right, x + w), min(bottom, y + h)
        if x1 <= x0 or y1 <= y0:
            continue
        rows.append(
            f"{PIECE_CLASSES.index(piece['piece'])} "
            f"{((x0 + x1) / 2 - left) / crop_width:.5f} {((y0 + y1) / 2 - top) / crop_height:.5f} "
            f"{(x1 - x0) / crop_width:.5f} {(y1 - y0) / crop_height:.5f}"
        )
    (OUT_PIECES / "labels" / split / f"{stem}.txt").write_text(
        "\n".join(rows) + "\n", encoding="utf-8"
    )
    return None


_archives: dict[tuple, SplitArchive] = {}


def _archive(parts: tuple) -> SplitArchive:
    if parts not in _archives:
        _archives[parts] = SplitArchive([Path(p) for p in parts])
    return _archives[parts]


def jobs_for(parts: tuple, split: str, limit: int | None) -> Iterator[tuple]:
    names = sorted(n for n in _archive(parts).members if n.endswith((".png", ".jpg")))
    for name in names[:limit]:
        yield parts, name, split


def write_dataset_yaml(root: Path, names: list[str]) -> None:
    listed = "\n".join(f"  {i}: {name}" for i, name in enumerate(names))
    text = f"path: {root.as_posix()}\ntrain: images/train\nval: images/val\nnames:\n{listed}\n"
    (root / "dataset.yaml").write_text(text, encoding="utf-8", newline="\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=None, help="only convert this many per split")
    parser.add_argument("--val-only", action="store_true", help="for trying out the conversion")
    args = parser.parse_args()

    for root in (OUT_PIECES, OUT_CORNERS):
        for kind in ("images", "labels"):
            for split in ("train", "val"):
                (root / kind / split).mkdir(parents=True, exist_ok=True)

    sources = [(("val.zip",), "val")]
    if not args.val_only:
        sources.append((("train.z01", "train.zip"), "train"))

    with Pool(8) as pool:
        for names, split in sources:
            parts = tuple(str(RAW / n) for n in names)
            jobs = list(jobs_for(parts, split, args.limit))
            for _ in pool.imap_unordered(convert, jobs, chunksize=8):
                pass
            print(f"{split}: {len(jobs)} images from {names}", flush=True)

    write_dataset_yaml(OUT_CORNERS, ["corner"])
    write_dataset_yaml(OUT_PIECES, list(PIECE_CLASSES))


if __name__ == "__main__":
    main()
