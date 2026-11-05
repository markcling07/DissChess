"""Downloads the artwork from a pinned commit and rasterises it. Run: python -m ptc_data.fetch"""

import subprocess
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

from ptc_data.assets import (
    BOARD_IMAGES,
    BOARDS_DIR,
    LILA_RAW,
    PIECE_NAMES,
    PIECE_SETS,
    PIECES_DIR,
    RAW_DIR,
)

RASTERISE_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "rasterise_pieces.mjs"
BOARD_SIZE = 1024


def download(url: str, path: Path) -> None:
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "photo-to-chess-data-fetch"})
    with urllib.request.urlopen(request, timeout=60) as response:
        path.write_bytes(response.read())


def main() -> None:
    jobs = [
        (f"{LILA_RAW}/piece/{name}/{piece}.svg", RAW_DIR / "pieces" / name / f"{piece}.svg")
        for name in PIECE_SETS
        for piece in PIECE_NAMES
    ]
    jobs += [
        (f"{LILA_RAW}/images/board/{file}", RAW_DIR / "boards" / file)
        for _, file in BOARD_IMAGES.values()
    ]
    with ThreadPoolExecutor(8) as pool:
        list(pool.map(lambda job: download(*job), jobs))
    print(f"Downloaded {len(jobs)} files")

    subprocess.run(
        ["node", str(RASTERISE_SCRIPT), str(RAW_DIR / "pieces"), str(PIECES_DIR)], check=True
    )

    BOARDS_DIR.mkdir(parents=True, exist_ok=True)
    for name, (_, file) in BOARD_IMAGES.items():
        with Image.open(RAW_DIR / "boards" / file) as image:
            image.convert("RGB").resize((BOARD_SIZE, BOARD_SIZE), Image.LANCZOS).save(
                BOARDS_DIR / f"{name}.png"
            )
    print(f"Prepared {len(BOARD_IMAGES)} board textures")


if __name__ == "__main__":
    main()
