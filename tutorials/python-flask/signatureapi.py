"""SignatureAPI client and webhook verification for the Flask tutorial. Standard library only."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Mapping


@dataclass(frozen=True)
class Config:
    api_key: str
    base_url: str = "https://api.signatureapi.com"
    webhook_secret: str = ""
    app_origin: str = "http://localhost:5000"


def get_config(env: Mapping[str, str] | None = None) -> Config:
    env = os.environ if env is None else env
    api_key = env.get("SIGNATUREAPI_KEY", "")
    if not api_key.startswith("key_test_"):
        raise ValueError("Set SIGNATUREAPI_KEY to a test API key (it starts with key_test_).")
    return Config(
        api_key=api_key,
        base_url=(env.get("SIGNATUREAPI_BASE_URL") or "https://api.signatureapi.com").rstrip("/"),
        webhook_secret=env.get("SIGNATUREAPI_WEBHOOK_SECRET", ""),
        app_origin=env.get("APP_ORIGIN", "http://localhost:5000"),
    )


class ApiError(Exception):
    def __init__(self, status: int, body: Any):
        detail = (body.get("detail") or body.get("title")) if isinstance(body, dict) else None
        super().__init__(f"SignatureAPI returned {status}" + (f": {detail}" if detail else ""))
        self.status = status


def api(config: Config, method: str, path: str, body: Any = None) -> Any:
    headers = {"X-API-Key": config.api_key, "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(config.base_url + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            parsed = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            parsed = None
        raise ApiError(error.code, parsed) from None


def build_contract(name: str, email: str, user_id: str, app_origin: str) -> dict[str, Any]:
    """Envelope for an embedded ceremony: custom authentication, embeddable_in, no email delivery."""
    return {
        "title": "Service Agreement",
        "metadata": {"app_user_id": user_id},
        "documents": [{
            "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
            "format": "pdf",
            "places": [{"key": "client_signature", "type": "signature", "recipient_key": "client"}],
            "fixed_positions": [{"place_key": "client_signature", "page": 1, "top": 172, "left": 210}],
        }],
        "recipients": [{
            "key": "client",
            "type": "signer",
            "name": name,
            "email": email,
            "delivery_type": "none",
            "ceremony": {
                "authentication": [{"type": "custom", "provider": "Acme Corp Portal", "data": {"user_id": user_id}}],
                "embeddable_in": [app_origin],
            },
        }],
    }


def create_signing_session(config: Config, name: str, email: str, user_id: str) -> dict[str, str]:
    """Creates the envelope and waits until it is in_progress.

    The ceremony opens only after the envelope leaves `processing`. Each read returns a fresh
    ceremony URL for the same ceremony.
    """
    envelope = api(config, "POST", "/v1/envelopes", build_contract(name, email, user_id, config.app_origin))
    for _ in range(30):
        if envelope["status"] != "processing":
            break
        time.sleep(1)
        envelope = api(config, "GET", f"/v1/envelopes/{envelope['id']}")
    if envelope["status"] != "in_progress":
        raise ApiError(502, {"detail": f"Envelope is {envelope['status']}, not ready for signing"})
    return {"envelopeId": envelope["id"], "ceremonyUrl": envelope["recipients"][0]["ceremony"]["url"]}


class NotReadyError(Exception):
    """The deliverable is not ready yet. The app answers 409 and the user tries again."""


def download_signed_pdf(config: Config, envelope_id: str) -> bytes:
    """Downloads the signed PDF of a completed envelope.

    The deliverable URL is pre-signed and expires after 1 hour, so fetch a fresh one each time
    instead of storing it. It needs no API key.
    """
    envelope = api(config, "GET", f"/v1/envelopes/{envelope_id}")
    if envelope["status"] != "completed" or not envelope.get("deliverable"):
        raise NotReadyError(f"Envelope is {envelope['status']}. The signed PDF exists once it is completed.")
    deliverable = api(config, "GET", f"/v1/deliverables/{envelope['deliverable']['id']}")
    if deliverable["status"] != "generated":
        raise NotReadyError(f"Deliverable is {deliverable['status']}. Try again in a few seconds.")
    with urllib.request.urlopen(deliverable["url"], timeout=60) as response:
        return response.read()


class WebhookError(Exception):
    pass


def verify_webhook(secret: str, headers: Mapping[str, str], raw_body: bytes, *,
                   now: int | None = None, tolerance_seconds: int = 300) -> dict:
    """Standard Webhooks verification. Returns the parsed event or raises WebhookError."""
    msg_id = headers.get("webhook-id")
    timestamp = headers.get("webhook-timestamp")
    signatures = headers.get("webhook-signature")
    if not (msg_id and timestamp and signatures):
        raise WebhookError("Missing webhook headers")
    now = int(time.time()) if now is None else now
    if not timestamp.isdigit() or abs(now - int(timestamp)) > tolerance_seconds:
        raise WebhookError("Webhook timestamp outside the tolerance window")
    key = base64.b64decode(secret.removeprefix("whsec_"))
    signed = f"{msg_id}.{timestamp}.".encode() + raw_body
    expected = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()
    for entry in signatures.split(" "):
        version, _, value = entry.partition(",")
        if version == "v1" and hmac.compare_digest(value, expected):
            return json.loads(raw_body)
    raise WebhookError("Invalid webhook signature")
