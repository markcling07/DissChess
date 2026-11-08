# The recognition service, for any container host (Google Cloud Run, Render, Fly.io, Railway).
# Build from this folder: docker build -t ptc-vision services/vision
# The models it runs are inside src/ptc_vision/models, so nothing else is needed.
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN pip install . && rm -rf /app/src /app/build

# Images are held in memory only, so the service needs no writable storage of its own.
RUN useradd --system --no-create-home ptc
USER ptc

# Hosts put a proxy in front and pass the visitor's address in X-Forwarded-For. Trusting it lets the
# per-visitor rate limit see visitors rather than the proxy. Narrow this if the host documents its
# proxy addresses. PTC_ALLOWED_ORIGINS must be set to the web app's address, such as
# https://photo-to-chess.pages.dev, or browsers will refuse the replies.
ENV PORT=8080 \
    FORWARDED_ALLOW_IPS="*"
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn --factory ptc_vision.api:create_app --host 0.0.0.0 --port \"$PORT\" --proxy-headers"]
