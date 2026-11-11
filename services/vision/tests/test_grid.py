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


def test_a_board_missing_half_a_square_is_still_called_cut_off():
    result = find_boards(draw_board(480)[:, 30:])
    assert result.incomplete
    assert not result.boards


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


def test_a_grid_of_more_than_eight_squares_isnt_located_as_part_of_itself():
    # A 10 by 10 checker has no single 8 by 8 board, whichever window is chosen.
    checker = np.indices((1000, 1000)).sum(axis=0) * 0
    checker = (np.indices((10, 10)).sum(axis=0) % 2 * 120 + 100).astype(np.uint8)
    image = cv2.resize(checker, (1000, 1000), interpolation=cv2.INTER_NEAREST)
    result = find_boards(cv2.cvtColor(image, cv2.COLOR_GRAY2RGB))
    assert len(result.boards) != 1 or result.boards[0].size_x < 1000
