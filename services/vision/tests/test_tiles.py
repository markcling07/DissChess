import numpy as np
from ptc_vision.tiles import crop_padded, extract_tiles


def squares(cell=40, cut=8):
    """A board of distinct square colours, with the left and top cut into by a few pixels."""
    board = np.zeros((8 * cell, 8 * cell, 3), dtype=np.uint8)
    for row in range(8):
        for column in range(8):
            board[row * cell : (row + 1) * cell, column * cell : (column + 1) * cell] = (
                row * 30,
                column * 30,
                120,
            )
    return board, board[cut:, cut:]


def test_squares_past_the_edge_are_filled_not_stretched():
    board, cropped = squares()
    tiles = extract_tiles(cropped, -8, -8, 320, 320, tile_size=40)
    full = extract_tiles(board, 0, 0, 320, 320, tile_size=40)
    # Every tile, including the cut edge ones, keeps its square's colour.
    assert np.array_equal(tiles[:, 20, 20], full[:, 20, 20])
    # The cut corner square is padded with its own colour, not a neighbour's.
    assert np.array_equal(tiles[0, 2, 2], full[0, 20, 20])


def test_crop_padded_inside_the_image_is_a_plain_crop():
    board, _ = squares()
    assert np.array_equal(crop_padded(board, 10, 20, 50, 70), board[20:70, 10:50])
