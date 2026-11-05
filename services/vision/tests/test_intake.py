import io
import struct
import zlib

import numpy as np
import pytest
from PIL import Image
from ptc_vision.intake import MAX_EDGE, MAX_FILE_BYTES, IntakeError, decode_image, sniff_format


def encode(image: Image.Image, image_format: str = "PNG", **options) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format=image_format, **options)
    return buffer.getvalue()


def solid(width=200, height=100, colour=(10, 20, 30), mode="RGB") -> Image.Image:
    return Image.new(mode, (width, height), colour)


def failure_code(data: bytes) -> str:
    with pytest.raises(IntakeError) as caught:
        decode_image(data)
    return caught.value.failure.code


def png_header_claiming(width: int, height: int) -> bytes:
    """A tiny PNG whose header claims a huge size, as a decompression bomb does."""
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    ihdr = b"IHDR" + header
    idat = b"IDAT" + zlib.compress(b"\x00" * 16)
    iend = b"IEND"
    chunks = b"".join(
        struct.pack(">I", len(chunk) - 4) + chunk + struct.pack(">I", zlib.crc32(chunk))
        for chunk in (ihdr, idat, iend)
    )
    return b"\x89PNG\r\n\x1a\n" + chunks


@pytest.mark.parametrize("image_format", ["PNG", "JPEG", "WEBP"])
def test_supported_formats_decode_to_rgb(image_format):
    rgb = decode_image(encode(solid(), image_format))
    assert rgb.shape == (100, 200, 3)
    assert rgb.dtype == np.uint8


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        (b"\xff\xd8\xff\xe0rest", "JPEG"),
        (b"\x89PNG\r\n\x1a\nrest", "PNG"),
        (b"RIFF\x00\x00\x00\x00WEBPrest", "WEBP"),
        (b"GIF89a", None),
        (b"<svg></svg>", None),
        (b"", None),
    ],
)
def test_format_comes_from_the_bytes(data, expected):
    assert sniff_format(data) == expected


@pytest.mark.parametrize(
    "data",
    [
        b"",
        b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
        b"<html><script>alert(1)</script></html>",
        b"MZ\x90\x00 an executable",
        b"%PDF-1.7",
        encode(solid(), "GIF"),
        encode(solid(), "BMP"),
        encode(solid(), "TIFF"),
    ],
)
def test_other_files_are_refused_whatever_they_claim_to_be(data):
    assert failure_code(data) == "unsupported_media_type"


def test_oversized_file_is_refused_before_decoding():
    assert failure_code(b"\xff\xd8\xff" + b"\x00" * MAX_FILE_BYTES) == "file_too_large"


def test_decompression_bomb_is_refused_from_its_header():
    assert failure_code(png_header_claiming(60000, 60000)) == "image_too_large"


def test_pixel_limit_applies_below_pillows_own_limit():
    assert failure_code(png_header_claiming(8000, 8000)) == "image_too_large"


@pytest.mark.parametrize("image_format", ["PNG", "JPEG", "WEBP"])
def test_truncated_file_is_refused(image_format):
    data = encode(solid(800, 800), image_format)
    assert failure_code(data[: len(data) // 2]) == "image_unreadable"


def test_header_with_nothing_after_it_is_refused():
    assert failure_code(b"\x89PNG\r\n\x1a\n") == "image_unreadable"
    assert failure_code(b"\xff\xd8\xff") == "image_unreadable"
    assert failure_code(b"RIFF\x00\x00\x00\x00WEBP") == "image_unreadable"


def test_too_small_to_read():
    assert failure_code(encode(solid(32, 32))) == "image_unreadable"


def test_large_image_is_reduced_keeping_its_shape():
    rgb = decode_image(encode(solid(4096, 2048)))
    assert rgb.shape == (MAX_EDGE // 2, MAX_EDGE, 3)


def test_small_image_is_left_at_its_size():
    assert decode_image(encode(solid(300, 200))).shape == (200, 300, 3)


def test_phone_rotation_tag_is_applied():
    image = solid(200, 100)
    exif = Image.Exif()
    exif[0x0112] = 6  # Rotate 90 degrees clockwise to display
    assert decode_image(encode(image, "JPEG", exif=exif)).shape == (200, 100, 3)


def test_transparency_is_flattened_onto_white():
    rgb = decode_image(encode(solid(100, 100, (0, 0, 0, 0), "RGBA")))
    assert rgb[50, 50].tolist() == [255, 255, 255]


@pytest.mark.parametrize("mode", ["L", "P", "LA", "1", "I;16"])
def test_unusual_pixel_modes_decode_to_rgb(mode):
    image = Image.new("L", (100, 100), 128).convert("RGB")
    converted = image.convert("I;16") if mode == "I;16" else image.convert(mode)
    assert decode_image(encode(converted)).shape == (100, 100, 3)


def test_result_is_writable_and_independent_of_the_input():
    rgb = decode_image(encode(solid()))
    rgb[0, 0] = 0
