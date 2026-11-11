"""The HTTP service. Images are held in memory for one request and never written anywhere.

Run: uvicorn --factory ptc_vision.api:create_app --port 8000

POST /api/v1/recognize takes the image as the request body. For a photo of a real board, the
corners the user tapped go in the query string, as corners=x1,y1,x2,y2,x3,y3,x4,y4 with each value
from 0 to 1 across the image as sent, in any order. Optionally, white=x,y is a point on the edge of
the board White sits behind, so the board's direction isn't guessed.
"""

import asyncio
import logging
import os
import time
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from ptc_vision.contract import FailureCode, Point, RecognitionFailure, RecognitionSuccess
from ptc_vision.engine import make_recognizer
from ptc_vision.intake import MAX_FILE_BYTES
from ptc_vision.photo import check_corners, make_photo_recognizer
from ptc_vision.recognizer import Recognizer, TappedRecognizer

logger = logging.getLogger("ptc_vision.api")

MAX_CONCURRENT = 2
TIMEOUT_SECONDS = 20.0
RATE_LIMIT_REQUESTS = 30
RATE_LIMIT_WINDOW_SECONDS = 60.0

STATUS_BY_CODE: dict[FailureCode, int] = {
    "unsupported_media_type": 415,
    "file_too_large": 413,
    "image_too_large": 413,
    "image_unreadable": 400,
    "no_board_detected": 422,
    "multiple_boards_detected": 422,
    "image_too_blurry": 422,
    "board_incomplete": 422,
    "recognition_timeout": 504,
    "invalid_corners": 400,
    "photos_unsupported": 422,
    "internal_error": 500,
}


def parse_corners(text: str) -> list[Point] | RecognitionFailure:
    """Reads tapped corners from the query string, or explains what's wrong with them."""
    invalid = RecognitionFailure(
        code="invalid_corners",
        message="The board corners weren't understood. Tap the four corners again.",
        retryable=True,
    )
    try:
        values = [float(part) for part in text.split(",")]
    except ValueError:
        return invalid
    if len(values) != 8 or not all(0.0 <= value <= 1.0 for value in values):
        return invalid
    corners = [Point(x=values[i], y=values[i + 1]) for i in range(0, 8, 2)]
    problem = check_corners(corners)
    if problem:
        return invalid.model_copy(update={"message": problem})
    return corners


def parse_white(text: str) -> Point | RecognitionFailure:
    """Reads the point on White's edge from the query string."""
    try:
        values = [float(part) for part in text.split(",")]
    except ValueError:
        values = []
    if len(values) != 2 or not all(0.0 <= value <= 1.0 for value in values):
        return RecognitionFailure(
            code="invalid_corners",
            message="White's side of the board wasn't understood. Mark it again.",
            retryable=True,
        )
    return Point(x=values[0], y=values[1])


def _failure_response(failure: RecognitionFailure) -> JSONResponse:
    return JSONResponse(
        failure.model_dump(mode="json"), status_code=STATUS_BY_CODE.get(failure.code, 500)
    )


class RateLimiter:
    """A sliding window per client, held in memory. Behind several workers each counts alone."""

    def __init__(
        self,
        limit: int = RATE_LIMIT_REQUESTS,
        window: float = RATE_LIMIT_WINDOW_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.limit = limit
        self.window = window
        self.clock = clock
        self._hits: defaultdict[str, deque[float]] = defaultdict(deque)

    def allow(self, client: str) -> bool:
        now = self.clock()
        hits = self._hits[client]
        while hits and now - hits[0] > self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            return False
        hits.append(now)
        if len(self._hits) > 10_000:
            self._hits = defaultdict(deque, {k: v for k, v in self._hits.items() if v})
        return True


def create_app(
    recognizer_factory: Callable[[], Recognizer] = make_recognizer,
    rate_limiter: RateLimiter | None = None,
    timeout_seconds: float = TIMEOUT_SECONDS,
    photo_recognizer_factory: Callable[[], TappedRecognizer | None] = make_photo_recognizer,
) -> FastAPI:
    app = FastAPI(title="Photo to Chess recognition", docs_url=None, redoc_url=None)
    limiter = rate_limiter or RateLimiter()
    slots = asyncio.Semaphore(MAX_CONCURRENT)

    async def run_limited(
        work: Callable[[], RecognitionSuccess | RecognitionFailure],
    ) -> RecognitionSuccess | RecognitionFailure:
        """Runs recognition on a worker thread, within the time limit and the number of slots.

        A thread can't be stopped, so one that runs past the limit keeps working after the reply has
        gone. Its slot is only given back when it really finishes. Otherwise slow images would pile
        up and starve a small server until it stops answering altogether.
        """

        def finished(task: asyncio.Task[RecognitionSuccess | RecognitionFailure]) -> None:
            slots.release()
            if not task.cancelled() and task.exception() is not None:
                logger.error("Recognition failed after its reply", exc_info=task.exception())

        async with asyncio.timeout(timeout_seconds):
            await slots.acquire()
            task = asyncio.create_task(asyncio.to_thread(work))
            task.add_done_callback(finished)
            # Shielded, because cancelling the task would give the slot back too early.
            return await asyncio.shield(task)

    recognizer = recognizer_factory()
    photo_recognizer = photo_recognizer_factory()

    origins = [o for o in os.environ.get("PTC_ALLOWED_ORIGINS", "").split(",") if o]
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_methods=["POST"],
            allow_headers=["Content-Type"],
        )

    @app.middleware("http")
    async def security_headers(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response

    # HEAD too, as uptime checkers such as UptimeRobot use it and would otherwise report a failure.
    @app.api_route("/healthz", methods=["GET", "HEAD"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post(
        "/api/v1/recognize",
        response_model=RecognitionSuccess | RecognitionFailure,
        responses={code: {"model": RecognitionFailure} for code in set(STATUS_BY_CODE.values())},
    )
    async def recognize(request: Request) -> Response:
        client = request.client.host if request.client else "unknown"
        if not limiter.allow(client):
            return JSONResponse(
                RecognitionFailure(
                    code="internal_error",
                    message="Too many images in a short time. Wait a minute and try again.",
                    retryable=True,
                ).model_dump(mode="json"),
                status_code=429,
                headers={"Retry-After": str(round(limiter.window))},
            )

        corners: list[Point] | None = None
        if "corners" in request.query_params:
            parsed = parse_corners(request.query_params["corners"])
            if isinstance(parsed, RecognitionFailure):
                return _failure_response(parsed)
            if photo_recognizer is None:
                return _failure_response(
                    RecognitionFailure(
                        code="photos_unsupported",
                        message="Photos of real boards can't be read yet. Use a screenshot, or "
                        "arrange the position by hand.",
                        retryable=False,
                    )
                )
            corners = parsed
        white: Point | None = None
        if "white" in request.query_params:
            parsed_white = parse_white(request.query_params["white"])
            if isinstance(parsed_white, RecognitionFailure):
                return _failure_response(parsed_white)
            if corners is None:
                return _failure_response(
                    RecognitionFailure(
                        code="invalid_corners",
                        message="White's side can only be given with the board's corners.",
                        retryable=True,
                    )
                )
            white = parsed_white

        # Read as a stream so an oversized upload is refused without being held in full.
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_FILE_BYTES:
                return _failure_response(
                    RecognitionFailure(
                        code="file_too_large",
                        message=f"The image is over {MAX_FILE_BYTES // 1024 // 1024} MB. "
                        "Use a smaller one.",
                        retryable=True,
                    )
                )

        try:
            image = bytes(body)
            if corners is not None and photo_recognizer is not None:
                tapped = corners
                reader = photo_recognizer
                result = await run_limited(lambda: reader.recognize(image, tapped, white))
            else:
                result = await run_limited(lambda: recognizer.recognize(image))
        except TimeoutError:
            return _failure_response(
                RecognitionFailure(
                    code="recognition_timeout",
                    message="This took too long to read. It may not be a screenshot of a digital "
                    "board. Try a screenshot, or arrange the position by hand.",
                    retryable=True,
                )
            )
        except Exception:
            # The cause goes in the log, and the image and internal details stay out of the reply.
            logger.exception("Recognition failed")
            return _failure_response(
                RecognitionFailure(
                    code="internal_error",
                    message="Something went wrong reading this image. Try again, or arrange the "
                    "position by hand.",
                    retryable=True,
                )
            )

        if isinstance(result, RecognitionFailure):
            return _failure_response(result)
        return JSONResponse(result.model_dump(mode="json"))

    return app
