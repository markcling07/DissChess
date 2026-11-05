"""The artwork used for training and testing, where it comes from, and what each may be used for.

The split decides what the numbers mean:

- train: the model learns from these. Licences must allow use in an open source project without a
  non-commercial restriction, because trained weights may count as derived from their data.
- calibration: never trained on. Used to stop training and tune confidence on unseen artwork.
- holdout: never trained on or tuned against. These are popular sets, most under non-commercial or
  unclear terms, used only to measure accuracy. They aren't committed or shipped.

All of it comes from the lichess-org/lila repository. Licences are as stated in its COPYING.md.
"""

from pathlib import Path
from typing import Literal

Split = Literal["train", "calibration", "holdout"]

LILA_COMMIT = "4eea97abce686a1cc6b07abe54cce9e10c223227"
LILA_RAW = f"https://raw.githubusercontent.com/lichess-org/lila/{LILA_COMMIT}/public"

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
RAW_DIR = DATA_DIR / "raw"
PIECES_DIR = DATA_DIR / "pieces"
BOARDS_DIR = DATA_DIR / "boards"

PIECE_NAMES = [c + p for c in "wb" for p in "KQRBNP"]

PIECE_SETS: dict[str, tuple[Split, str]] = {
    "cburnett": ("train", "GPL-2.0-or-later"),
    "merida": ("train", "GPL-2.0-or-later"),
    "pirouetti": ("train", "AGPL-3.0-or-later"),
    "pixel": ("train", "AGPL-3.0-or-later"),
    "rhosgfx": ("train", "CC0-1.0"),
    "fantasy": ("train", "MIT"),
    "spatial": ("train", "MIT"),
    "mpchess": ("train", "GPL-3.0-or-later"),
    "totoy": ("train", "CC-BY-4.0"),
    "papercut": ("train", "CC-BY-4.0"),
    "firi": ("train", "CC-BY-4.0"),
    "chessnut": ("calibration", "Apache-2.0"),
    "celtic": ("calibration", "MIT"),
    "maestro": ("holdout", "CC-BY-NC-SA-4.0, testing only"),
    "california": ("holdout", "CC-BY-NC-SA-4.0, testing only"),
    "tatiana": ("holdout", "CC-BY-NC-SA-4.0, testing only"),
    "staunty": ("holdout", "CC-BY-NC-SA-4.0, testing only"),
    "cardinal": ("holdout", "CC-BY-NC-SA-4.0, testing only"),
    "gioco": ("holdout", "CC-BY-NC-SA-4.0, testing only"),
    "alpha": ("holdout", "free for non-commercial use, testing only"),
    "leipzig": ("holdout", "freeware, testing only"),
    "companion": ("holdout", "freeware, testing only"),
}

# All AGPL-3.0-or-later, from public/images/board.
BOARD_IMAGES: dict[str, tuple[Split, str]] = {
    "wood": ("train", "wood.jpg"),
    "wood2": ("train", "wood2.jpg"),
    "maple": ("train", "maple.jpg"),
    "marble": ("train", "marble.jpg"),
    "metal": ("train", "metal.jpg"),
    "olive": ("train", "olive.jpg"),
    "grey": ("train", "grey.jpg"),
    "leather": ("train", "leather.jpg"),
    "purple": ("train", "purple.png"),
    "blue2": ("train", "blue2.jpg"),
    "canvas2": ("calibration", "canvas2.jpg"),
    "ic": ("calibration", "ic.png"),
    "brown": ("holdout", "brown.png"),
    "green": ("holdout", "green.png"),
    "blue": ("holdout", "blue.png"),
    "maple2": ("holdout", "maple2.jpg"),
    "blue-marble": ("holdout", "blue-marble.jpg"),
}

# Plain colours of well known sites. Training palettes keep away from these, so a holdout result
# says something about board colours the model hasn't seen.
HOLDOUT_PALETTES: dict[str, tuple[tuple[int, int, int], tuple[int, int, int]]] = {
    "site-green": ((238, 238, 210), (118, 150, 86)),
    "site-brown": ((240, 217, 181), (181, 136, 99)),
    "site-blue": ((222, 227, 230), (140, 162, 173)),
    "site-walnut": ((237, 214, 176), (184, 135, 98)),
    "site-dark": ((173, 189, 143), (111, 143, 114)),
    "site-purple": ((239, 239, 239), (136, 119, 183)),
}


def sets_in(split: Split) -> list[str]:
    return [name for name, (s, _) in PIECE_SETS.items() if s == split]


def boards_in(split: Split) -> list[str]:
    return [name for name, (s, _) in BOARD_IMAGES.items() if s == split]
