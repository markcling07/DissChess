"""Writes the small test images committed with the code. Run: python -m ptc_data.build_fixtures

They use only cburnett (GPL-2.0-or-later) and plain colours, so they can be shipped in this repo.
"""

import json
import random
from pathlib import Path

from PIL import Image, ImageDraw
from ptc_vision.board import parse_placement

from ptc_data.render import Style, compose_page, render_board

OUT = Path(__file__).resolve().parents[3] / "apps" / "web" / "e2e" / "fixtures"

MIDGAME = "r1bq1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1"
ITALIAN = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R"
ENDGAME = "8/5k2/8/8/3K4/8/4P3/8"
START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"

GREEN = Style(piece_set="cburnett", theme="palette", light=(235, 236, 208), dark=(115, 149, 82))
BROWN = Style(piece_set="cburnett", theme="palette", light=(240, 217, 181), dark=(181, 136, 99))


def board(style: Style, placement: str, size: int, flipped: bool, seed: int) -> Image.Image:
    rng = random.Random(seed)
    return render_board(rng, style, parse_placement(placement), size, flipped).image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    expected = {}

    def save(name: str, image: Image.Image, **details) -> None:
        image.save(OUT / name, **({"quality": 90} if name.endswith((".jpg", ".webp")) else {}))
        expected[name] = details

    save("midgame.png", board(GREEN, MIDGAME, 400, False, 1), placement=MIDGAME, flipped=False)
    save("start.png", board(BROWN, START, 320, False, 3), placement=START, flipped=False)
    save("flipped.jpg", board(BROWN, ITALIAN, 480, True, 2), placement=ITALIAN, flipped=True)
    save("endgame.webp", board(GREEN, ENDGAME, 360, False, 4), placement=ENDGAME, flipped=False)

    rng = random.Random(5)
    page, _ = compose_page(rng, board(BROWN, ITALIAN, 480, False, 6))
    save("on-page.png", page, placement=ITALIAN, flipped=False)

    blank = Image.new("RGB", (640, 360), (230, 230, 235))
    draw = ImageDraw.Draw(blank)
    for row in range(10):
        draw.text((30, 20 + row * 30), "A page with no chessboard in it", fill=(70, 70, 70))
    save("no-board.png", blank, failure="no_board_detected")

    two = Image.new("RGB", (880, 440), (30, 30, 30))
    two.paste(board(GREEN, MIDGAME, 400, False, 7), (20, 20))
    two.paste(board(GREEN, ITALIAN, 400, False, 8), (460, 20))
    save("two-boards.png", two, failure="multiple_boards_detected")

    save(
        "cut-off.png",
        board(GREEN, MIDGAME, 400, False, 9).crop((0, 0, 400, 220)),
        failure="board_incomplete",
    )

    (OUT / "expected.json").write_text(
        json.dumps(expected, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    print(f"Wrote {len(expected)} fixtures to {OUT}")


if __name__ == "__main__":
    main()
