"""Shared helpers for the SignatureAPI Python scripts. Standard library only (Python 3.10+)."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

DEFAULT_BASE_URL = "https://api.signatureapi.com"
SAMPLE_PDF_URL = "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf"


@dataclass(frozen=True)
class Config:
    api_key: str
    base_url: str = DEFAULT_BASE_URL


def get_config(env: dict[str, str] | None = None) -> Config:
    """Read the API key and base URL from the environment. Test keys only."""
    env = os.environ if env is None else env
    api_key = env.get("SIGNATUREAPI_KEY", "")
    if not api_key:
        raise ValueError("Set SIGNATUREAPI_KEY to your test API key (it starts with key_test_).")
    if not api_key.startswith("key_test_"):
        raise ValueError("These examples run in test mode only. Use a key that starts with key_test_.")
    base_url = (env.get("SIGNATUREAPI_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
    return Config(api_key=api_key, base_url=base_url)


class ApiError(Exception):
    """Raised for any non-2xx response. Carries the status and the parsed problem body."""

    def __init__(self, status: int, body: Any):
        detail = body.get("detail") or body.get("title") if isinstance(body, dict) else body
        super().__init__(f"SignatureAPI returned {status}" + (f": {detail}" if detail else ""))
        self.status = status
        self.body = body


def api(config: Config, method: str, path: str, *, json_body: Any = None,
        data: bytes | None = None, content_type: str | None = None) -> Any:
    """Call the API and return the parsed JSON body."""
    headers = {"X-API-Key": config.api_key, "Accept": "application/json"}
    if json_body is not None:
        data = json.dumps(json_body).encode()
        headers["Content-Type"] = "application/json"
    elif content_type:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(config.base_url + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            text = response.read().decode()
    except urllib.error.HTTPError as error:
        raw = error.read().decode()
        try:
            body: Any = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            body = raw
        raise ApiError(error.code, body) from None
    return json.loads(text) if text else None


def build_service_agreement(name: str = "Jane Doe", email: str = "jane.doe@example.com",
                            metadata: dict[str, str] | None = None) -> dict[str, Any]:
    """One-signer envelope for the sample Service Agreement.

    The sample PDF has no [[placeholders]], so the signature place uses fixed coordinates.
    """
    return {
        "title": "Service Agreement",
        "message": "Hi, please review and sign the Acme Corp Service Agreement.",
        "metadata": metadata or {},
        "documents": [
            {
                "url": SAMPLE_PDF_URL,
                "format": "pdf",
                "places": [{"key": "client_signature", "type": "signature", "recipient_key": "client"}],
                "fixed_positions": [{"place_key": "client_signature", "page": 1, "top": 172, "left": 210}],
            }
        ],
        "recipients": [{"key": "client", "type": "signer", "name": name, "email": email}],
    }


def fail(error: Exception) -> None:
    """Print an error the way every script does, then exit non-zero."""
    print(f"Error: {error}", file=sys.stderr)
    if isinstance(error, ApiError) and isinstance(error.body, dict) and error.body.get("errors"):
        print(json.dumps(error.body["errors"], indent=2), file=sys.stderr)
    sys.exit(1)
