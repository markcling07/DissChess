# The recognition service as a Hugging Face Docker Space. Copy this file and README.md into the Space.
# It installs the service straight from GitHub, so the Space holds no code or models of its own.
# After changing the service, use "Factory rebuild" in the Space's settings to pick up main.
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && pip install "ptc-vision @ git+https://github.com/markcling07/DissChess@main#subdirectory=services/vision" \
    && apt-get purge -y git \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Spaces run containers as an unprivileged user, and images are held in memory only.
USER 1000

# FORWARDED_ALLOW_IPS trusts the host's proxy, so the rate limit sees visitors rather than the proxy.
# PTC_ALLOWED_ORIGINS is the web app's address. Browsers refuse replies to any other site.
ENV PORT=7860 \
    FORWARDED_ALLOW_IPS="*" \
    PTC_ALLOWED_ORIGINS="https://disschess.pages.dev"
EXPOSE 7860
CMD ["sh", "-c", "exec uvicorn --factory ptc_vision.api:create_app --host 0.0.0.0 --port \"$PORT\" --proxy-headers"]
