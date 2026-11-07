import io
import time

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from ptc_vision.api import RateLimiter, create_app
from ptc_vision.board import ALL_SQUARES
from ptc_vision.contract import RecognitionFailure, RecognitionSuccess, recognition_response_adapter
from ptc_vision.intake import MAX_FILE_BYTES

URL = "/api/v1/recognize"


def png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (100, 100)).save(buffer, format="PNG")
    return buffer.getvalue()


def success() -> RecognitionSuccess:
    corners = [{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}, {"x": 0, "y": 1}]
    return RecognitionSuccess(
        source_kind="screenshot",
        board={"corners": corners, "confidence": 1},
        orientation={
            "quarter_turns_cw": 0,
            "confidence": 1,
            "method": "piece_layout",
            "needs_review": False,
        },
        placement="8/8/8/8/8/8/8/8",
        squares=[
            {"square": s, "label": "empty", "confidence": 1, "needs_review": False}
            for s in ALL_SQUARES
        ],
        engine={"name": "test", "version": "0"},
    )


class Scripted:
    def __init__(self, result=None, error=None, delay=0.0):
        self.result = result if result is not None else success()
        self.error = error
        self.delay = delay
        self.received = []

    def recognize(self, image: bytes):
        self.received.append(image)
        if self.delay:
            time.sleep(self.delay)
        if self.error:
            raise self.error
        return self.result


def client_for(recognizer, photo=None, **options) -> TestClient:
    return TestClient(
        create_app(lambda: recognizer, photo_recognizer_factory=lambda: photo, **options),
        raise_server_exceptions=False,
    )


def test_success_returns_a_valid_response():
    response = client_for(Scripted()).post(URL, content=png())
    assert response.status_code == 200
    parsed = recognition_response_adapter.validate_python(response.json())
    assert isinstance(parsed, RecognitionSuccess)


def test_the_image_reaches_the_recognizer_unchanged():
    recognizer = Scripted()
    data = png()
    client_for(recognizer).post(URL, content=data)
    assert recognizer.received == [data]


@pytest.mark.parametrize(
    ("code", "status"),
    [
        ("no_board_detected", 422),
        ("multiple_boards_detected", 422),
        ("image_too_blurry", 422),
        ("board_incomplete", 422),
        ("unsupported_media_type", 415),
        ("file_too_large", 413),
        ("image_too_large", 413),
        ("image_unreadable", 400),
    ],
)
def test_failures_keep_their_message_and_get_a_matching_status(code, status):
    failure = RecognitionFailure(code=code, message="Try again.", retryable=True)
    response = client_for(Scripted(failure)).post(URL, content=png())
    assert response.status_code == status
    assert response.json()["code"] == code
    assert response.json()["message"] == "Try again."


def test_an_oversized_upload_is_refused_without_reaching_the_recognizer():
    recognizer = Scripted()
    response = client_for(recognizer).post(URL, content=b"x" * (MAX_FILE_BYTES + 1))
    assert response.status_code == 413
    assert response.json()["code"] == "file_too_large"
    assert recognizer.received == []


def test_a_crash_hides_internal_details():
    secret = "C:\\internal\\path\\model.onnx failed"
    response = client_for(Scripted(error=RuntimeError(secret))).post(URL, content=png())
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"
    assert "internal" not in response.json()["message"]
    assert secret not in response.text


def test_a_slow_image_times_out_with_a_useful_message():
    client = client_for(Scripted(delay=0.5), timeout_seconds=0.05)
    response = client.post(URL, content=png())
    assert response.status_code == 504
    assert response.json()["code"] == "recognition_timeout"


def test_rate_limit_refuses_with_a_retry_hint():
    client = client_for(Scripted(), rate_limiter=RateLimiter(limit=2, window=60))
    assert client.post(URL, content=png()).status_code == 200
    assert client.post(URL, content=png()).status_code == 200
    response = client.post(URL, content=png())
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "60"


def test_rate_limit_recovers_after_the_window():
    now = [0.0]
    limiter = RateLimiter(limit=1, window=10, clock=lambda: now[0])
    assert limiter.allow("a")
    assert not limiter.allow("a")
    assert limiter.allow("b")
    now[0] = 11.0
    assert limiter.allow("a")


def test_replies_arent_cached_or_sniffed():
    response = client_for(Scripted()).post(URL, content=png())
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Cache-Control"] == "no-store"


def test_health_check_doesnt_touch_the_recognizer():
    recognizer = Scripted()
    assert client_for(recognizer).get("/healthz").json() == {"status": "ok"}
    assert recognizer.received == []


def test_only_post_is_accepted():
    assert client_for(Scripted()).get(URL).status_code == 405


def test_no_cross_origin_access_unless_configured(monkeypatch):
    monkeypatch.delenv("PTC_ALLOWED_ORIGINS", raising=False)
    response = client_for(Scripted()).post(URL, content=png(), headers={"Origin": "https://x.test"})
    assert "access-control-allow-origin" not in response.headers


def test_configured_origin_is_allowed(monkeypatch):
    monkeypatch.setenv("PTC_ALLOWED_ORIGINS", "https://app.test")
    client = client_for(Scripted())
    allowed = client.post(URL, content=png(), headers={"Origin": "https://app.test"})
    assert allowed.headers["access-control-allow-origin"] == "https://app.test"
    other = client.post(URL, content=png(), headers={"Origin": "https://other.test"})
    assert "access-control-allow-origin" not in other.headers


class TappedScripted(Scripted):
    def recognize(self, image: bytes, corners, white=None):
        self.corners = corners
        self.white = white
        return super().recognize(image)


CORNERS = "0.1,0.1,0.9,0.1,0.9,0.9,0.1,0.9"


def test_tapped_corners_go_to_the_photo_recognizer():
    screenshots, photos = Scripted(), TappedScripted()
    response = client_for(screenshots, photo=photos).post(f"{URL}?corners={CORNERS}", content=png())
    assert response.status_code == 200
    assert screenshots.received == []
    assert [round(p.x, 2) for p in photos.corners] == [0.1, 0.9, 0.9, 0.1]


def test_whites_side_goes_to_the_photo_recognizer():
    photos = TappedScripted()
    response = client_for(Scripted(), photo=photos).post(
        f"{URL}?corners={CORNERS}&white=0.5,0.9", content=png()
    )
    assert response.status_code == 200
    assert (photos.white.x, photos.white.y) == (0.5, 0.9)


@pytest.mark.parametrize(
    "query", [f"corners={CORNERS}&white=0.5", f"corners={CORNERS}&white=x,y", "white=0.5,0.9"]
)
def test_bad_or_lone_whites_side_is_refused(query):
    photos = TappedScripted()
    response = client_for(Scripted(), photo=photos).post(f"{URL}?{query}", content=png())
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_corners"
    assert photos.received == []


def test_without_corners_the_screenshot_recognizer_is_used():
    screenshots, photos = Scripted(), TappedScripted()
    client_for(screenshots, photo=photos).post(URL, content=png())
    assert len(screenshots.received) == 1
    assert photos.received == []


@pytest.mark.parametrize(
    "corners",
    [
        "1,2,3",
        "0.1,0.1,0.9,0.1,0.9,0.9,0.1,1.5",
        "a,b,c,d,e,f,g,h",
        "0.5,0.5,0.51,0.5,0.51,0.51,0.5,0.51",
    ],
)
def test_bad_corners_are_refused_before_reading(corners):
    photos = TappedScripted()
    response = client_for(Scripted(), photo=photos).post(f"{URL}?corners={corners}", content=png())
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_corners"
    assert photos.received == []


def test_corners_are_refused_when_no_photo_reader_is_installed():
    response = client_for(Scripted(), photo=None).post(f"{URL}?corners={CORNERS}", content=png())
    assert response.status_code == 422
    body = recognition_response_adapter.validate_python(response.json())
    assert body.code == "photos_unsupported"
    assert not body.retryable
