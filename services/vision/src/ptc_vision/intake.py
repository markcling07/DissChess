"""Turns untrusted upload bytes into a safe, bounded image, or a failure the user can act on.

The file's claimed type is ignored. Type comes from its first bytes, and pixel dimensions are
checked from the header before any decoding, so a small file can't expand into a huge image in
memory. Metadata such as location is dropped, because only pixels leave this module.
"""

import io
import warnings

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from ptc_vision.contract import FailureCode, RecognitionFailure

MAX_FILE_BYTES = 15 * 1024 * 1024
MAX_PIXELS = 50_000_000
MAX_EDGE = 2048
MIN_EDGE = 64

# Pillow's limit then refuses extreme sizes outright. Sizes just over it are refused below, so its
# warning adds nothing. This is set once here because changing warning filters isn't thread-safe.
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
warnings.filterwarnings("ignore", category=Image.DecompressionBombWarning)


class IntakeError(Exception):
    def __init__(self, code: FailureCode, message: str, retryable: bool = True):
        super().__init__(message)
        self.failure = RecognitionFailure(code=code, message=message, retryable=retryable)


def sniff_format(data: bytes) -> str | None:
    """The image format according to the file's own bytes."""
    if data.startswith(b"\xff\xd8\xff"):
        return "JPEG"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    return None


def decode_image(data: bytes) -> np.ndarray:
    """Returns an RGB uint8 array, upright and at most MAX_EDGE on its longest side."""
    if len(data) > MAX_FILE_BYTES:
        raise IntakeError(
            "file_too_large",
            f"The image is over {MAX_FILE_BYTES // 1024 // 1024} MB. Use a smaller one.",
        )
    image_format = sniff_format(data)
    if image_format is None:
        raise IntakeError("unsupported_media_type", "Use a JPG, PNG or WEBP image.")

    try:
        with Image.open(io.BytesIO(data), formats=[image_format]) as image:
            width, height = image.size
            if width * height > MAX_PIXELS:
                raise IntakeError(
                    "image_too_large", "The image has too many pixels. Use a smaller one."
                )
            if min(width, height) < MIN_EDGE:
                raise IntakeError(
                    "image_unreadable", "The image is too small to read a chessboard from."
                )
            # Phone photos are often stored sideways with a tag saying which way is up.
            upright = ImageOps.exif_transpose(image)
            rgb = _flatten_to_rgb(upright)
    except IntakeError:
        raise
    except Image.DecompressionBombError as error:
        raise IntakeError(
            "image_too_large", "The image has too many pixels. Use a smaller one."
        ) from error
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as error:
        raise IntakeError(
            "image_unreadable", "This image couldn't be read. It may be damaged."
        ) from error

    longest = max(rgb.shape[:2])
    if longest > MAX_EDGE:
        scale = MAX_EDGE / longest
        size = (round(rgb.shape[1] * scale), round(rgb.shape[0] * scale))
        rgb = cv2.resize(rgb, size, interpolation=cv2.INTER_AREA)
    return rgb


def _flatten_to_rgb(image: Image.Image) -> np.ndarray:
    if image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info:
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        return np.asarray(Image.alpha_composite(background, rgba).convert("RGB")).copy()
    return np.asarray(image.convert("RGB")).copy()
