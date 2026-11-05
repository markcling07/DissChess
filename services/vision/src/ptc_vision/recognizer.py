"""The interface every recognition engine implements.

The API service and the evaluation tool depend only on this, so an engine can be replaced without
changing either of them or the game.
"""

from typing import Protocol

from ptc_vision.contract import RecognitionFailure, RecognitionSuccess


class Recognizer(Protocol):
    def recognize(self, image: bytes) -> RecognitionSuccess | RecognitionFailure:
        """Recognise one encoded image. Expected problems are returned as RecognitionFailure."""
        ...
