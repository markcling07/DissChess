"""Downloads a free asset from an itch.io page, the way its download button does.

Run: python -m ptc_photo.fetch_itch <page url> <output folder>

Only for pages whose licence has been checked. Every upload on the page is saved.
"""

import argparse
import http.cookiejar
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) photo-to-chess-dataset-fetch"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("page")
    parser.add_argument("out", type=Path)
    args = parser.parse_args()

    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )

    def request(url: str, data: dict | None = None) -> bytes:
        body = urllib.parse.urlencode(data).encode() if data is not None else None
        headers = {"User-Agent": AGENT}
        if data is not None:
            headers["X-Requested-With"] = "XMLHttpRequest"
        with opener.open(urllib.request.Request(url, body, headers), timeout=60) as response:
            return response.read()

    page = request(args.page).decode("utf-8", "replace")
    token = re.search(r'name="csrf_token" value="([^"]+)"', page)
    uploads = re.findall(r'data-upload_id="(\d+)"', page)
    if not token or not uploads:
        sys.exit("No free download found on that page")

    base = args.page.rstrip("/")
    args.out.mkdir(parents=True, exist_ok=True)
    for upload in dict.fromkeys(uploads):
        reply = json.loads(
            request(f"{base}/file/{upload}?source=view_game&as_props=1", {"csrf_token": token[1]})
        )
        url = reply["url"]
        name = Path(urllib.parse.urlparse(url).path).name or f"{upload}.zip"
        data = request(url)
        (args.out / name).write_bytes(data)
        print(f"{name}: {len(data)} bytes", flush=True)


if __name__ == "__main__":
    main()
