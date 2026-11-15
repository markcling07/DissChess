import cv2
import numpy as np
import pytest
from ptc_vision.grid import find_boards

LIGHT = (238, 238, 210)
DARK = (118, 150, 86)


def draw_board(size=480, light=LIGHT, dark=DARK, pieces=True, seed=1) -> np.ndarray:
    """A plain board with blobs for pieces, which are enough to hide parts of the grid lines."""
    board = np.zeros((size, size, 3), dtype=np.uint8)
    cell = size / 8
    for row in range(8):
        for column in range(8):
            colour = dark if (row + column) % 2 else light
            cv2.rectangle(
                board,
                (round(column * cell), round(row * cell)),
                (round((column + 1) * cell) - 1, round((row + 1) * cell) - 1),
                colour,
                -1,
            )
    if pieces:
        rng = np.random.default_rng(seed)
        for _ in range(16):
            row, column = rng.integers(0, 8, 2)
            centre = (round((column + 0.5) * cell), round((row + 0.5) * cell))
            colour = (20, 20, 20) if rng.random() < 0.5 else (245, 245, 245)
            cv2.circle(board, centre, round(cell * 0.33), colour, -1)
    return board


def on_page(board: np.ndarray, x=60, y=40, width=None, height=None, colour=(30, 30, 40)):
    size = board.shape[0]
    page = np.full((height or size + y + 50, width or size + x + 300, 3), colour, dtype=np.uint8)
    page[y : y + size, x : x + size] = board
    return page


def assert_located(result, x, y, size, tolerance=2.0):
    assert len(result.boards) == 1, result
    found = result.boards[0]
    assert abs(found.x - x) <= tolerance
    assert abs(found.y - y) <= tolerance
    assert abs(found.size_x - size) <= tolerance
    assert abs(found.size_y - size) <= tolerance


@pytest.mark.parametrize("size", [128, 200, 320, 480, 512, 800, 1024])
def test_finds_a_tightly_cropped_board_at_any_size(size):
    assert_located(find_boards(draw_board(size)), 0, 0, size)


@pytest.mark.parametrize("size", [203, 333, 487])
def test_finds_a_board_with_fractional_squares(size):
    assert_located(find_boards(draw_board(size)), 0, 0, size)


@pytest.mark.parametrize(("x", "y"), [(60, 40), (0, 90), (130, 0), (17, 23)])
def test_finds_a_board_on_a_page(x, y):
    assert_located(find_boards(on_page(draw_board(480), x, y)), x, y, 480)


def test_finds_an_empty_board():
    assert_located(find_boards(draw_board(480, pieces=False)), 0, 0, 480)


@pytest.mark.parametrize(
    ("light", "dark"),
    [
        ((240, 217, 181), (181, 136, 99)),
        ((222, 227, 230), (140, 162, 173)),
        ((200, 200, 200), (170, 170, 170)),
        ((90, 90, 110), (50, 50, 70)),
    ],
)
def test_finds_different_board_colours(light, dark):
    assert_located(find_boards(draw_board(480, light, dark)), 0, 0, 480)


def test_a_frame_around_the_board_doesnt_shift_the_grid():
    board = draw_board(480)
    framed = np.full((520, 520, 3), (70, 45, 30), dtype=np.uint8)
    framed[20:500, 20:500] = board
    assert_located(find_boards(framed), 20, 20, 480)


def test_a_textured_frame_with_coordinates_is_found():
    """A wood-textured board with a beveled frame and coordinate labels."""
    board_size, frame = 480, 35
    total = board_size + 2 * frame
    cell = board_size / 8
    rng = np.random.default_rng(99)

    image = np.full((total, total, 3), (70, 45, 30), dtype=np.uint8)
    noise = rng.integers(-12, 12, image.shape, dtype=np.int16)
    image = np.clip(image.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    for i in range(frame):
        image[i, :] = np.clip(image[i, :].astype(np.int16) + 30 * (frame - i) // frame, 0, 255)
        image[:, i] = np.clip(image[:, i].astype(np.int16) + 20 * (frame - i) // frame, 0, 255)

    for row in range(8):
        for column in range(8):
            base = (210, 180, 140) if (row + column) % 2 == 0 else (150, 100, 60)
            x0, y0 = frame + round(column * cell), frame + round(row * cell)
            x1, y1 = frame + round((column + 1) * cell), frame + round((row + 1) * cell)
            cv2.rectangle(image, (x0, y0), (x1 - 1, y1 - 1), base, -1)
            for y in range(y0, y1):
                shift = int(8 * np.sin(y * 0.15))
                image[y, x0:x1] = np.clip(image[y, x0:x1].astype(np.int16) + shift, 0, 255)

    for i in range(8):
        pos = (frame + 3, frame + round(i * cell + cell * 0.35))
        cv2.putText(image, str(8 - i), pos, cv2.FONT_HERSHEY_SIMPLEX, 0.35, (80, 50, 30), 1)
        pos = (frame + round(i * cell + cell * 0.6), frame + board_size - 5)
        cv2.putText(image, chr(ord("a") + i), pos, cv2.FONT_HERSHEY_SIMPLEX, 0.35, (200, 170, 130), 1)

    assert_located(find_boards(image), frame, frame, board_size)


def test_evenly_spaced_text_beside_the_board_doesnt_shift_the_grid():
    page = on_page(draw_board(800), 40, 30, height=880, width=1400)
    for row in range(36):
        cv2.putText(
            page,
            "1. e4 e5 2. Nf3 Nc6",
            (860, 40 + row * 22),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (220, 220, 220),
            1,
        )
    assert_located(find_boards(page), 40, 30, 800)


def test_two_similar_boards_are_both_reported():
    page = np.full((520, 1040, 3), (30, 30, 30), dtype=np.uint8)
    page[20:500, 20:500] = draw_board(480, seed=1)
    page[20:500, 540:1020] = draw_board(480, seed=2)
    assert len(find_boards(page).boards) == 2


def test_a_thumbnail_beside_the_main_board_doesnt_count_as_a_second_board():
    page = np.full((560, 960, 3), (30, 30, 30), dtype=np.uint8)
    page[20:500, 20:500] = draw_board(480)
    page[20:180, 600:760] = draw_board(160, seed=3)
    assert_located(find_boards(page), 20, 20, 480)


@pytest.mark.parametrize("shaved", [5, 7, 12])
def test_a_board_cropped_slightly_into_its_edge_squares_is_still_found(shaved):
    # Up to a fifth of a 60-pixel square cut off the left and top, as in tight screenshots.
    result = find_boards(draw_board(480)[shaved:, shaved:])
    assert_located(result, -shaved, -shaved, 480)


def test_a_board_missing_half_a_square_is_still_found():
    # Half a square (30 of 60 pixels) cropped from the left. The board extends past the image's
    # edge, but crop_padded fills the gap, so it's better to read it than to give up.
    result = find_boards(draw_board(480)[:, 30:])
    assert_located(result, -30, 0, 480)


@pytest.mark.parametrize("height", [180, 240, 330])
def test_a_cut_off_board_is_reported_as_incomplete(height):
    result = find_boards(draw_board(480)[:height])
    assert result.incomplete
    assert not result.boards


def test_a_board_cut_off_at_the_side_is_reported_as_incomplete():
    result = find_boards(draw_board(480)[:, :300])
    assert result.incomplete
    assert not result.boards


def test_heavy_blur_is_reported():
    blurred = cv2.GaussianBlur(draw_board(480), (0, 0), 18)
    result = find_boards(blurred)
    assert result.blurry
    assert not result.boards


def test_a_blank_image_has_no_board_and_isnt_called_blurry():
    result = find_boards(np.full((400, 400, 3), 128, dtype=np.uint8))
    assert not result.boards
    assert not result.blurry
    assert not result.incomplete


def test_random_noise_has_no_board():
    noise = np.random.default_rng(1).integers(0, 255, (400, 600, 3)).astype(np.uint8)
    assert not find_boards(noise).boards


def test_a_plain_table_grid_isnt_a_board():
    table = np.full((800, 800, 3), 250, dtype=np.uint8)
    for step in range(0, 800, 100):
        cv2.line(table, (step, 0), (step, 799), (180, 180, 180), 1)
        cv2.line(table, (0, step), (799, step), (180, 180, 180), 1)
    result = find_boards(table)
    assert not result.boards
    assert not result.incomplete


def test_a_puzzle_screenshot_with_highlights_and_arrows_is_found():
    """A board with semi-transparent highlighted squares, thick arrows, and a banner."""
    board_size = 560
    cell = board_size / 8
    banner_h, controls_h = 60, 50
    total_h = banner_h + board_size + controls_h
    light = np.array(LIGHT, dtype=np.float32)
    dark = np.array(DARK, dtype=np.float32)

    image = np.full((total_h, board_size, 3), (48, 46, 43), dtype=np.uint8)
    cv2.rectangle(image, (0, 0), (board_size, banner_h), (38, 36, 33), -1)
    cv2.putText(image, "Brilliant Move!", (20, 38), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (255, 200, 50), 2)

    board = np.zeros((board_size, board_size, 3), dtype=np.float32)
    for row in range(8):
        for col in range(8):
            x0, y0 = round(col * cell), round(row * cell)
            x1, y1 = round((col + 1) * cell), round((row + 1) * cell)
            board[y0:y1, x0:x1] = light if (row + col) % 2 == 0 else dark

    for row, col in [(3, 4), (5, 5)]:
        x0, y0 = round(col * cell), round(row * cell)
        x1, y1 = round((col + 1) * cell), round((row + 1) * cell)
        board[y0:y1, x0:x1] = board[y0:y1, x0:x1] * 0.5 + 127

    board_u8 = np.clip(board, 0, 255).astype(np.uint8)
    p1 = (round(5.5 * cell), round(5.5 * cell))
    p2 = (round(3.5 * cell), round(3.5 * cell))
    cv2.arrowedLine(board_u8, p1, p2, (100, 200, 80), 10, tipLength=0.15)

    image[banner_h : banner_h + board_size, :] = board_u8
    assert_located(find_boards(image), 0, banner_h, board_size)


def test_grid_detection_finishes_in_time_on_noisy_images():
    """Even with heavy texture, detection stays well under the API timeout."""
    import time

    rng = np.random.default_rng(7)
    size = 1000
    frame = 60
    cell = (size - 2 * frame) / 8
    image = rng.integers(50, 100, (size, size, 3), dtype=np.uint8)
    for row in range(8):
        for column in range(8):
            base = np.array([200, 180, 140] if (row + column) % 2 == 0 else [140, 100, 60])
            x0, y0 = frame + round(column * cell), frame + round(row * cell)
            x1, y1 = frame + round((column + 1) * cell), frame + round((row + 1) * cell)
            noise = rng.integers(-10, 10, (y1 - y0, x1 - x0, 3), dtype=np.int16)
            image[y0:y1, x0:x1] = np.clip(base + noise, 0, 255).astype(np.uint8)

    start = time.perf_counter()
    result = find_boards(image)
    elapsed = time.perf_counter() - start
    assert elapsed < 5.0, f"took {elapsed:.1f}s"
    assert len(result.boards) == 1


def test_a_grid_of_more_than_eight_squares_isnt_located_as_part_of_itself():
    # A 10 by 10 checker has no single 8 by 8 board, whichever window is chosen.
    checker = np.indices((1000, 1000)).sum(axis=0) * 0
    checker = (np.indices((10, 10)).sum(axis=0) % 2 * 120 + 100).astype(np.uint8)
    image = cv2.resize(checker, (1000, 1000), interpolation=cv2.INTER_NEAREST)
    result = find_boards(cv2.cvtColor(image, cv2.COLOR_GRAY2RGB))
    assert len(result.boards) != 1 or result.boards[0].size_x < 1000
