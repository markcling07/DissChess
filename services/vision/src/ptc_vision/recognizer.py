"""The interface every recognition engine implements.

The API service and the evaluation tool depend only on this, so an engine can be replaced without
changing either of them or the game.
"""

from typing import Protocol

from ptc_vision.contract import Point, RecognitionFailure, RecognitionSuccess


class Recognizer(Protocol):
    def recognize(self, image: bytes) -> RecognitionSuccess | RecognitionFailure:
        """Recognise one encoded image. Expected problems are returned as RecognitionFailure."""
        ...


class TappedRecognizer(Protocol):
    def recognize(
        self, image: bytes, corners: list[Point], white: Point | None = None
    ) -> RecognitionSuccess | RecognitionFailure:
        """Recognise a photo whose board corners the user tapped, in normalised coordinates.

        White, when given, is a point on the edge of the board White sits behind.
        """
        ...
