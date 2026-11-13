"""One JSON POST helper for Jev and the LLM.

Why urllib: both providers are a single POST; no SDK needed.
Not swallowing errors: a failed call raises ProviderError. Falling back to a mock mid-run
would produce cost and accuracy figures that look live but are not.
"""
import json
import time
import urllib.error
import urllib.request


class ProviderError(RuntimeError):
    pass


def post_json(url: str, key: str, body: dict, timeout: int = 40, retries: int = 2) -> tuple[dict, float]:
    """Returns (response, seconds). Retries only rate limits and server errors."""
    payload = json.dumps(body).encode("utf-8")
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=payload, method="POST",
                                     headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read()), time.perf_counter() - started
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            if e.code in (429, 500, 502, 503) and attempt < retries:
                time.sleep(1.5 * (attempt + 1))
                continue
            hint = " (no credit on the account)" if e.code == 402 else ""
            raise ProviderError(f"{url} -> HTTP {e.code}{hint}: {detail or e.reason}") from None
        except urllib.error.URLError as e:
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise ProviderError(f"{url} unreachable: {e.reason}") from None
