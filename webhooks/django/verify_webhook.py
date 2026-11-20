"""Verify Standard Webhooks signatures with the standard library only."""

import base64
import hashlib
import hmac
import time


class WebhookVerificationError(Exception):
    pass


def verify_webhook(secret, headers, raw_body, now=None, tolerance_seconds=300):
    """Return True when the delivery is authentic, otherwise raise WebhookVerificationError.

    secret: signing secret, "whsec_<base64 key>".
    headers: mapping of request headers (names matched case-insensitively).
    raw_body: the exact bytes (or str) received. Never a re-serialized object.
    now: Unix seconds, defaults to the clock.
    """
    if now is None:
        now = int(time.time())
    lower = {name.lower(): value for name, value in headers.items()}
    msg_id = lower.get("webhook-id")
    timestamp = lower.get("webhook-timestamp")
    signature_header = lower.get("webhook-signature")
    if not msg_id or not timestamp or not signature_header:
        raise WebhookVerificationError("Missing webhook-id, webhook-timestamp or webhook-signature header")

    if not timestamp.isdigit():
        raise WebhookVerificationError("Invalid webhook-timestamp")
    if abs(now - int(timestamp)) > tolerance_seconds:
        raise WebhookVerificationError("Timestamp outside the tolerance window")

    key = base64.b64decode(secret.removeprefix("whsec_"))
    body = raw_body.encode("utf-8") if isinstance(raw_body, str) else raw_body
    signed = f"{msg_id}.{timestamp}.".encode("utf-8") + body
    expected = hmac.new(key, signed, hashlib.sha256).digest()

    # The header holds space-separated "v1,<base64>" entries. Any match is enough.
    for entry in signature_header.split(" "):
        version, _, signature = entry.partition(",")
        if version != "v1" or not signature:
            continue
        try:
            candidate = base64.b64decode(signature, validate=True)
        except ValueError:
            continue
        if hmac.compare_digest(candidate, expected):
            return True
    raise WebhookVerificationError("No matching signature")
