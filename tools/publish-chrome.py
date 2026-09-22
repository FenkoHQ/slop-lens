"""Submit a verified release ZIP using the existing Fenko Chrome credentials."""
import json
import os
from pathlib import Path
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ITEM_ID = "mcnjjendjmakiioflhhjijdnffiejiih"
TOKEN_URL = "https://oauth2.googleapis.com/token"
ITEM_URL = f"https://www.googleapis.com/chromewebstore/v1.1/items/{ITEM_ID}"
UPLOAD_URL = f"https://www.googleapis.com/upload/chromewebstore/v1.1/items/{ITEM_ID}?uploadType=media"
POLL_SECONDS = 5
POLL_ATTEMPTS = 24
REQUEST_TIMEOUT = 60


def request(url, method, data=None, headers=None):
    req = Request(url, data=data, headers=headers or {}, method=method)
    with urlopen(req, timeout=REQUEST_TIMEOUT) as response:
        return json.load(response)


def publish(archive):
    credentials = {
        "client_id": os.environ["CHROME_CLIENT_ID"],
        "client_secret": os.environ["CHROME_CLIENT_SECRET"],
        "refresh_token": os.environ["CHROME_REFRESH_TOKEN"],
        "grant_type": "refresh_token",
    }
    if not all(credentials.values()):
        raise RuntimeError("Chrome publishing credentials are missing")
    token = request(TOKEN_URL, "POST", urlencode(credentials).encode(),
                    {"Content-Type": "application/x-www-form-urlencoded"}).get("access_token")
    if not token:
        raise RuntimeError("Chrome OAuth did not return an access token")
    headers = {"Authorization": f"Bearer {token}", "x-goog-api-version": "2"}
    uploaded = request(UPLOAD_URL, "PUT", Path(archive).read_bytes(),
                       {**headers, "Content-Type": "application/zip"})
    for _ in range(POLL_ATTEMPTS):
        if uploaded.get("uploadState") != "IN_PROGRESS":
            break
        time.sleep(POLL_SECONDS)
        uploaded = request(ITEM_URL + "?projection=DRAFT", "GET", headers=headers)
    if uploaded.get("uploadState") != "SUCCESS":
        raise RuntimeError("CWS upload failed: " + json.dumps(uploaded.get("itemError", uploaded.get("uploadState"))))
    result = request(ITEM_URL + "/publish", "POST", b"", headers)
    statuses = set(result.get("status", []))
    if not statuses or not statuses <= {"OK", "ITEM_PENDING_REVIEW"}:
        raise RuntimeError("CWS submission failed: " + json.dumps(result))
    return "Pending Chrome Web Store review" if "ITEM_PENDING_REVIEW" in statuses else "Chrome Web Store publish request accepted"


if __name__ == "__main__":
    try:
        status = publish(sys.argv[1])
        print(status)
        if os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
                summary.write(f"{status}. Item: `{ITEM_ID}`.\n")
    except HTTPError as error:
        sys.exit(f"Chrome Web Store API request failed: HTTP {error.code}")
    except (KeyError, RuntimeError) as error:
        sys.exit(str(error))
