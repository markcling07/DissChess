"""Renders chessboards that look like real screenshots, with the true position known exactly.

Sites differ in what they draw over a board, so the renderer varies all of it: highlights, move
hints, arrows, coordinates, shadows, surrounding page, scaling and compression. The model should
learn the pieces and not any one site's look.
"""

import io
import math
import random
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import chess
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from ptc_data.assets import (
    BOARDS_DIR,
    HOLDOUT_PALETTES,
    PIECES_DIR,
    Split,
    boards_in,
    sets_in,
)

FONT_PATHS = ["arial.ttf", "segoeui.ttf", "verdana.ttf", "DejaVuSans.ttf"]
type RGB = tuple[int, int, int]


@dataclass(frozen=True)
class BoardRender:
    image: Image.Image
    board: dict[str, str]  # True label of each square, "empty" or a FEN letter
    flipped: bool
    tags: tuple[str, ...]


@dataclass
class Style:
    piece_set: str
    theme: str  # A board texture name or "palette"
    light: RGB = (240, 240, 240)
    dark: RGB = (100, 100, 100)
    tags: list[str] = field(default_factory=list)
    # Sets to draw altered pieces from, for training. Empty means draw the artwork as it is.
    variation_sets: tuple[str, ...] = ()


# Pieces whose bodies can look alike, so only the top tells them apart. A person reads a king by its
# cross. Swapping bodies between them stops a model from relying on the body instead.
BODY_SWAP_PARTNERS = {"K": "Q", "Q": "K", "B": "P"}


def _varied_piece(
    rng: random.Random, sets: tuple[str, ...], piece_set: str, code: str
) -> Image.Image:
    """A piece that exists in no real set, so training sees far more designs than it has artwork."""
    base = _piece_image(piece_set, code, 256).copy()
    upper = code.upper()
    white = code.isupper()

    if rng.random() < 0.55:
        # Keep this piece's top, and give it another design's body.
        if upper in BODY_SWAP_PARTNERS and rng.random() < 0.35:
            other = BODY_SWAP_PARTNERS[upper]
            other = other if white else other.lower()
        else:
            other = code
        body = _piece_image(rng.choice(sets), other, 256)
        cut = round(256 * rng.uniform(0.28, 0.5))
        mixed = body.copy()
        mixed.paste(base.crop((0, 0, 256, cut)), (0, 0))
        base = mixed

    if rng.random() < 0.7:
        angle = math.radians(rng.uniform(-5, 5))
        scale_x = 1 / rng.uniform(0.82, 1.15)
        scale_y = 1 / rng.uniform(0.85, 1.12)
        if upper == "P" and rng.random() < 0.5:
            # Older designs have tall, thin pawns that are easy to mistake for bishops.
            scale_x = 1 / rng.uniform(0.75, 1.0)
            scale_y = 1 / rng.uniform(1.1, 1.4)
        shear = rng.uniform(-0.06, 0.06)
        cos, sin = math.cos(angle), math.sin(angle)
        a, b = cos * scale_x, (sin + shear) * scale_x
        d, e = -sin * scale_y, cos * scale_y
        centre = 128
        base = base.transform(
            (256, 256),
            Image.AFFINE,
            (a, b, centre - a * centre - b * centre, d, e, centre - d * centre - e * centre),
            Image.BILINEAR,
        )

    if rng.random() < 0.3:
        alpha = base.getchannel("A")
        grown = alpha.filter(
            ImageFilter.MaxFilter(5) if rng.random() < 0.6 else ImageFilter.MinFilter(5)
        )
        base.putalpha(grown)

    if rng.random() < 0.6:
        base = _recolour(base, rng, white)
    if rng.random() < 0.12:
        base = _hatch(base, rng, white)
    return base


def _hatch(piece: Image.Image, rng: random.Random, white: bool) -> Image.Image:
    """Adds line shading, which designs taken from printed chess fonts often have."""
    data = np.asarray(piece).copy()
    spacing = rng.randint(14, 30)
    width = rng.randint(3, 7)
    colour = rng.randint(0, 50) if white else rng.randint(200, 255)
    rows = (np.arange(256) % spacing) < width
    data[rows, :, :3] = colour
    return Image.fromarray(data, "RGBA")


def _recolour(piece: Image.Image, rng: random.Random, white: bool) -> Image.Image:
    """Maps shades onto a new range, as artists colour White and Black pieces differently."""
    data = np.asarray(piece).astype(np.float32)
    shade = data[..., :3].mean(axis=2, keepdims=True) / 255
    tint = np.array([rng.uniform(0.85, 1.0) for _ in range(3)], dtype=np.float32)
    if white:
        low = np.array([rng.randint(0, 70)] * 3, dtype=np.float32)
        high = rng.uniform(205, 255) * tint
    else:
        low = rng.uniform(0, 45) * tint
        high = rng.uniform(70, 165) * tint
    data[..., :3] = low + shade * (high - low)
    return Image.fromarray(np.clip(data, 0, 255).astype("uint8"), "RGBA")


@lru_cache(maxsize=512)
def _piece_image(piece_set: str, code: str, size: int) -> Image.Image:
    white = code.isupper()
    path = PIECES_DIR / piece_set / f"{'w' if white else 'b'}{code.upper()}.png"
    with Image.open(path) as image:
        return image.convert("RGBA").resize((size, size), Image.LANCZOS)


@lru_cache(maxsize=32)
def _texture(name: str) -> Image.Image:
    with Image.open(BOARDS_DIR / f"{name}.png") as image:
        return image.convert("RGB")


def _font(size: int) -> ImageFont.ImageFont:
    for path in FONT_PATHS:
        try:
            return ImageFont.truetype(path, max(6, size))
        except OSError:
            continue
    return ImageFont.load_default(max(6, size))


def sample_palette(rng: random.Random, split: Split) -> tuple[str, RGB, RGB]:
    """A plain board palette. Holdout uses named site colours, which training keeps away from."""
    if split == "holdout":
        name = rng.choice(list(HOLDOUT_PALETTES))
        light, dark = HOLDOUT_PALETTES[name]
        return name, light, dark
    while True:
        hue = rng.random()
        contrast = rng.uniform(0.15, 0.55)
        value = rng.uniform(0.62, 0.97)
        saturation = rng.uniform(0, 0.55)
        light = _hsv(hue, saturation * 0.35, value)
        dark = _hsv(hue + rng.uniform(-0.04, 0.04), saturation, max(0.1, value - contrast))
        if all(_distance(light, a) + _distance(dark, b) > 70 for a, b in HOLDOUT_PALETTES.values()):
            return "palette", light, dark


def _distance(a: RGB, b: RGB) -> int:
    return sum(abs(x - y) for x, y in zip(a, b, strict=True))


def _hsv(hue: float, saturation: float, value: float) -> RGB:
    image = Image.new("HSV", (1, 1), (int(hue % 1 * 255), int(saturation * 255), int(value * 255)))
    return image.convert("RGB").getpixel((0, 0))


def sample_style(rng: random.Random, split: Split, vary_pieces: bool = False) -> Style:
    piece_set = rng.choice(sets_in(split))
    variation_sets = tuple(sets_in(split)) if vary_pieces and rng.random() < 0.85 else ()
    # Most real boards are plain colours, so those take the larger share.
    if rng.random() < 0.3:
        return Style(
            piece_set=piece_set, theme=rng.choice(boards_in(split)), variation_sets=variation_sets
        )
    theme, light, dark = sample_palette(rng, split)
    return Style(
        piece_set=piece_set, theme=theme, light=light, dark=dark, variation_sets=variation_sets
    )


def sample_position(rng: random.Random) -> tuple[dict[str, str], str]:
    """A position and its kind: random play, a sparse endgame, or dense arbitrary pieces.

    Every position has one king per side, as a real game does. Random play isn't how people play, so
    orientation results on these are a harder test than ordinary games.
    """
    kind = rng.random()
    board = chess.Board()
    name = "play"
    if kind < 0.65:
        for _ in range(rng.randint(0, 140)):
            moves = list(board.legal_moves)
            if not moves:
                break
            board.push(rng.choice(moves))
    else:
        board.clear()
        squares = list(chess.SQUARES)
        rng.shuffle(squares)
        name = "sparse" if kind < 0.85 else "arbitrary"
        count = rng.randint(2, 8) if kind < 0.85 else rng.randint(4, 32)
        codes = ["K", "k"] + rng.choices("PNBRQpnbrq", k=max(0, count - 2))
        for square, code in zip(squares, codes, strict=False):
            if code in "Pp" and chess.square_rank(square) in (0, 7):
                code = "Q" if code == "P" else "q"
            board.set_piece_at(square, chess.Piece.from_symbol(code))

    result = {}
    for square in chess.SQUARES:
        piece = board.piece_at(square)
        result[chess.square_name(square)] = piece.symbol() if piece else "empty"
    return result, name


def _cell_origin(square: str, flipped: bool, cell: float) -> tuple[float, float]:
    file = ord(square[0]) - 97
    rank = int(square[1]) - 1
    column = 7 - file if flipped else file
    row = rank if flipped else 7 - rank
    return column * cell, row * cell


def _shift_texture(image: Image.Image, rng: random.Random) -> Image.Image:
    """Recolours a board texture, so training sees many more materials than it has pictures of."""
    hsv = np.asarray(image.convert("HSV")).astype(np.int16)
    hsv[..., 0] = (hsv[..., 0] + rng.randint(0, 255)) % 256
    hsv[..., 1] = np.clip(hsv[..., 1] * rng.uniform(0.6, 1.3), 0, 255)
    shifted = Image.fromarray(hsv.astype("uint8"), "HSV").convert("RGB")
    return shifted


def _add_veins(image: Image.Image, rng: random.Random) -> Image.Image:
    """Draws marble-like veins, because a vein can otherwise look like part of a piece."""
    size = image.size[0]
    layer = Image.new("L", image.size, 0)
    draw = ImageDraw.Draw(layer)
    for _ in range(rng.randint(10, 60)):
        x, y = rng.uniform(0, size), rng.uniform(0, size)
        angle = rng.uniform(0, math.tau)
        points = [(x, y)]
        for _ in range(rng.randint(3, 14)):
            angle += rng.uniform(-0.8, 0.8)
            step = rng.uniform(0.02, 0.09) * size
            x, y = x + math.cos(angle) * step, y + math.sin(angle) * step
            points.append((x, y))
        draw.line(points, fill=rng.randint(60, 255), width=rng.randint(1, max(2, size // 200)))
    layer = layer.filter(ImageFilter.GaussianBlur(rng.uniform(0.5, 2.5)))
    colour = rng.choice([(255, 255, 255), (20, 20, 20), (200, 200, 220)])
    return Image.composite(Image.new("RGB", image.size, colour), image, layer)


def _background(style: Style, size: int, rng: random.Random) -> Image.Image:
    training = bool(style.variation_sets)
    if style.theme in (*boards_in("train"), *boards_in("calibration"), *boards_in("holdout")):
        image = _texture(style.theme).resize((size, size), Image.BILINEAR)
        if training and rng.random() < 0.6:
            image = _shift_texture(image, rng)
        if training and rng.random() < 0.25:
            image = _add_veins(image, rng)
        return image
    image = Image.new("RGB", (size, size), style.light)
    draw = ImageDraw.Draw(image)
    cell = size / 8
    for row in range(8):
        for column in range(8):
            if (row + column) % 2 == 1:
                draw.rectangle(
                    [
                        round(column * cell),
                        round(row * cell),
                        round((column + 1) * cell) - 1,
                        round((row + 1) * cell) - 1,
                    ],
                    fill=style.dark,
                )
    if rng.random() < 0.15:
        noise = np.random.default_rng(rng.getrandbits(32)).normal(0, 4, (size, size, 3))
        image = Image.fromarray(np.clip(np.asarray(image) + noise, 0, 255).astype("uint8"))
    if training and rng.random() < 0.2:
        image = _add_veins(image, rng)
    return image


def _tint(layer: ImageDraw.ImageDraw, box: list[float], colour: RGB, alpha: int) -> None:
    layer.rectangle(box, fill=(*colour, alpha))


def _draw_highlights(
    image: Image.Image,
    rng: random.Random,
    board: dict[str, str],
    flipped: bool,
    cell: float,
    tags: list[str],
) -> Image.Image:
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    squares = list(board)

    def box(square: str) -> list[float]:
        x, y = _cell_origin(square, flipped, cell)
        return [x, y, x + cell - 1, y + cell - 1]

    if rng.random() < 0.65:
        tags.append("last-move")
        colour = rng.choice([(155, 199, 0), (246, 246, 105), (205, 210, 106), (130, 180, 240)])
        alpha = rng.randint(70, 170)
        for square in rng.sample(squares, 2):
            _tint(draw, box(square), colour, alpha)

    if rng.random() < 0.15:
        tags.append("check")
        for square, code in board.items():
            if code in ("K", "k") and rng.random() < 0.6:
                x, y = _cell_origin(square, flipped, cell)
                for step in range(8, 0, -1):
                    inset = (8 - step) * cell / 18
                    draw.ellipse(
                        [x + inset, y + inset, x + cell - inset, y + cell - inset],
                        fill=(230, 30, 20, 25 + (8 - step) * 22),
                    )
                break

    if rng.random() < 0.2:
        tags.append("move-hints")
        colour = rng.choice([(20, 85, 30), (0, 0, 0), (60, 60, 60)])
        _tint(draw, box(rng.choice(squares)), (20, 85, 30), rng.randint(60, 130))
        for square in rng.sample(squares, rng.randint(2, 10)):
            x, y = _cell_origin(square, flipped, cell)
            if board[square] == "empty":
                radius = cell * rng.uniform(0.1, 0.18)
                center = (x + cell / 2, y + cell / 2)
                draw.ellipse(
                    [
                        center[0] - radius,
                        center[1] - radius,
                        center[0] + radius,
                        center[1] + radius,
                    ],
                    fill=(*colour, rng.randint(50, 130)),
                )
            else:
                draw.ellipse(
                    [x + 1, y + 1, x + cell - 1, y + cell - 1],
                    outline=(*colour, rng.randint(50, 130)),
                    width=max(2, round(cell * 0.08)),
                )

    if rng.random() < 0.05:
        tags.append("hover-border")
        draw.rectangle(box(rng.choice(squares)), outline=(255, 255, 255, 200), width=2)

    return Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")


def _draw_coordinates(
    image: Image.Image, rng: random.Random, flipped: bool, cell: float, style: Style
) -> None:
    draw = ImageDraw.Draw(image)
    font = _font(round(cell * rng.uniform(0.14, 0.24)))
    files = "abcdefgh"[::-1] if flipped else "abcdefgh"
    ranks = "12345678" if flipped else "87654321"
    upper = rng.random() < 0.2
    rank_on_right = rng.random() < 0.35
    size = image.size[0]
    for index in range(8):
        on_light_rank = (index % 2 == 0) == rank_on_right
        colour = style.dark if on_light_rank else style.light
        x = size - cell * 0.2 if rank_on_right else cell * 0.04
        draw.text((x, index * cell + cell * 0.03), ranks[index], fill=colour, font=font)
        letter = files[index].upper() if upper else files[index]
        colour = style.dark if index % 2 == 1 else style.light
        draw.text((index * cell + cell * 0.78, size - cell * 0.28), letter, fill=colour, font=font)


def _draw_pieces(
    image: Image.Image,
    rng: random.Random,
    board: dict[str, str],
    style: Style,
    flipped: bool,
    cell: float,
) -> None:
    scale = rng.uniform(0.82, 1.0)
    size = max(4, round(cell * scale))
    margin = (cell - size) / 2
    shadow = rng.random() < 0.15
    varied: dict[str, Image.Image] = {}
    for square, code in board.items():
        if code == "empty":
            continue
        if style.variation_sets:
            if code not in varied:
                design = _varied_piece(rng, style.variation_sets, style.piece_set, code)
                varied[code] = design.resize((size, size), Image.LANCZOS)
            piece = varied[code]
        else:
            piece = _piece_image(style.piece_set, code, size)
        x, y = _cell_origin(square, flipped, cell)
        position = (round(x + margin), round(y + margin))
        if shadow:
            alpha = piece.getchannel("A").filter(ImageFilter.GaussianBlur(max(1, size / 30)))
            dark = Image.new("RGBA", piece.size, (0, 0, 0, 0))
            dark.putalpha(alpha.point(lambda v: int(v * 0.35)))
            offset = max(1, round(size * 0.02))
            image.paste(dark, (position[0] + offset, position[1] + offset), dark)
        image.paste(piece, position, piece)


def _draw_arrows(image: Image.Image, rng: random.Random, flipped: bool, cell: float) -> Image.Image:
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    colour = rng.choice([(21, 120, 27), (136, 32, 32), (0, 48, 136), (230, 143, 0), (255, 170, 0)])
    alpha = rng.randint(110, 190)
    squares = [chess.square_name(s) for s in chess.SQUARES]
    for _ in range(rng.randint(1, 3)):
        start, end = rng.sample(squares, 2)
        ax, ay = _cell_origin(start, flipped, cell)
        bx, by = _cell_origin(end, flipped, cell)
        a = (ax + cell / 2, ay + cell / 2)
        b = (bx + cell / 2, by + cell / 2)
        width = max(2, round(cell * 0.16))
        draw.line([a, b], fill=(*colour, alpha), width=width)
        angle = math.atan2(b[1] - a[1], b[0] - a[0])
        head = cell * 0.35
        draw.polygon(
            [
                (b[0] + math.cos(angle) * head * 0.6, b[1] + math.sin(angle) * head * 0.6),
                (b[0] + math.cos(angle + 2.5) * head, b[1] + math.sin(angle + 2.5) * head),
                (b[0] + math.cos(angle - 2.5) * head, b[1] + math.sin(angle - 2.5) * head),
            ],
            fill=(*colour, alpha),
        )
    return Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")


def render_board(
    rng: random.Random, style: Style, board: dict[str, str], size: int, flipped: bool
) -> BoardRender:
    # Drawn at twice the size and reduced, which gives the soft edges real browsers produce.
    draw_size = (size + (8 - size % 8) % 8) * 2
    cell = draw_size / 8
    tags = list(style.tags)
    if flipped:
        tags.append("flipped")

    image = _background(style, draw_size, rng)
    image = _draw_highlights(image, rng, board, flipped, cell, tags)
    if rng.random() < 0.6:
        tags.append("coordinates")
        _draw_coordinates(image, rng, flipped, cell, style)
    _draw_pieces(image, rng, board, style, flipped, cell)
    if rng.random() < 0.12:
        tags.append("arrows")
        image = _draw_arrows(image, rng, flipped, cell)

    image = image.resize((size, size), Image.LANCZOS)
    return BoardRender(image=image, board=board, flipped=flipped, tags=tuple(tags))


def jpeg_round_trip(image: Image.Image, quality: int) -> Image.Image:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality)
    buffer.seek(0)
    with Image.open(buffer) as result:
        return result.convert("RGB")


def compose_page(
    rng: random.Random, board_image: Image.Image, frame: int = 0
) -> tuple[Image.Image, tuple[int, int, int, int]]:
    """Places a board on a page with panels and text. Returns the page and the board's rectangle."""
    size = board_image.size[0]
    dark_page = rng.random() < 0.6
    background = (
        rng.randint(20, 55) if dark_page else rng.randint(225, 250),
        rng.randint(20, 55) if dark_page else rng.randint(225, 250),
        rng.randint(20, 60) if dark_page else rng.randint(225, 250),
    )
    panel_colour = tuple(min(255, c + (18 if dark_page else -18)) for c in background)
    text_colour = (210, 210, 210) if dark_page else (50, 50, 50)

    left = rng.randint(0, 140)
    top = rng.randint(0, 110)
    right_panel = rng.choice([0, 0, rng.randint(180, 520)])
    width = left + size + right_panel + rng.randint(0, 80)
    height = top + size + rng.randint(0, 110)
    page = Image.new("RGB", (width, height), background)
    draw = ImageDraw.Draw(page)
    font = _font(rng.randint(11, 17))

    if top > 24:
        draw.rectangle([0, 0, width, top // 2], fill=panel_colour)
        draw.text((8, 4), "Play  Puzzles  Learn  Watch", fill=text_colour, font=font)
    if right_panel:
        x = left + size + 12
        draw.rectangle([x, top, width - 8, top + size], fill=panel_colour)
        for row in range(rng.randint(4, 20)):
            y = top + 12 + row * 22
            if y < top + size - 14:
                draw.text(
                    (x + 8, y), f"{row + 1}. e4 e5 Nf3 Nc6 Bb5 a6", fill=text_colour, font=font
                )
    if frame:
        draw.rectangle(
            [left - frame, top - frame, left + size + frame - 1, top + size + frame - 1],
            fill=rng.choice([(70, 45, 30), (40, 40, 40), (120, 90, 60)]),
        )
    page.paste(board_image, (left, top))
    return page, (left, top, size, size)


def write_image(path: Path, image: Image.Image, rng: random.Random) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == ".jpg":
        image.save(path, quality=rng.randint(70, 95))
    elif path.suffix == ".webp":
        image.save(path, quality=rng.randint(75, 95))
    else:
        image.save(path)
