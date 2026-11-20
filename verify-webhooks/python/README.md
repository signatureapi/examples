# Verify SignatureAPI webhook signatures in Python

## The problem

SignatureAPI sends events such as `envelope.completed` to your webhook endpoint. Anyone who knows your URL can post to it. You must check the signature before you trust a delivery. A wrong check either rejects real events or accepts forged ones.

## What you build

A single function, `verify_webhook(secret, headers, raw_body, now=None)`, that implements [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md#verifying-webhook-authenticity) verification with the Python standard library only. It returns normally when the delivery is authentic and fails when it is not. A test runs every case in the shared [`test-vector.json`](../test-vector.json), and a small command line demo verifies one delivery.

## Prerequisites

- Python 3.10 or newer. No packages to install.
- The signing secret of your webhook endpoint (`whsec_...`). Find it in the [dashboard](https://dashboard.signatureapi.com/settings/webhooks).

## Step by step

1. **Collect three headers.** Every delivery carries `webhook-id`, `webhook-timestamp` (Unix seconds) and `webhook-signature`. If one is missing, reject the request. Header names are case-insensitive, so the code lowercases them first.
2. **Check the timestamp.** Reject a delivery whose timestamp is more than 5 minutes from your clock. This blocks replays of captured requests.
3. **Compute the expected signature.** Decode the secret (drop the `whsec_` prefix, base64-decode the rest). Compute HMAC-SHA256 over `<webhook-id>.<webhook-timestamp>.<raw body>`.
4. **Compare in constant time.** The `webhook-signature` header holds one or more space-separated entries such as `v1,<base64>`. A delivery is authentic if any `v1` entry equals the expected value. Use the language's constant-time comparison, never `==`.
5. **Pass the raw body.** The signature covers the exact bytes SignatureAPI sent. In Flask use `request.get_data()`. In FastAPI use `await request.body()`. In Django use `request.body`. Never pass `json.dumps(request.json)`.

The core of the Python implementation (`verify_webhook.py`):

```python
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
```

## Run it

```bash
cd python
SIGNATUREAPI_WEBHOOK_SECRET=whsec_xxxxxxxx python3 verify_cli.py path/to/delivery.json
```

`delivery.json` holds `{"headers": {...}, "body": "..."}`. Without a path, the demo checks the valid case from the shared test vector, using the vector's fixed clock.

## Expected output

```text
$ python3 verify_cli.py
valid signature
```

For a forged delivery the demo prints `invalid: No matching signature` to stderr and exits with code 1.

## Run the tests

```bash
cd python
python3 -m unittest -v
```

Real output:

```text
test_accepts_bytes (test_verify_webhook.ExtraTests) ... ok
test_header_names_are_case_insensitive (test_verify_webhook.ExtraTests) ... ok
test_timestamp_too_old (test_verify_webhook.VectorTests) ... ok
test_valid (test_verify_webhook.VectorTests) ... ok
...
Ran 8 tests in 0.002s

OK
```

The tests pass the vector's `now` (1793632930) to the verifier, so the tolerance check is deterministic. The vector has six cases: a valid delivery, a delivery with several signatures (one wrong, one right), a tampered body, a signature from the wrong secret, a timestamp 10 minutes old, and missing headers.

## Troubleshooting

- **Every delivery fails with "No matching signature".** You are verifying a parsed and re-serialized body, or the wrong secret. Test mode and live mode endpoints have different signing secrets.
- **Only some deliveries fail.** A proxy or middleware changed the body (whitespace, encoding, gzip). Read the body before any parser touches it.
- **"Timestamp outside the tolerance window".** Your server clock is off by more than 5 minutes. Fix NTP rather than widening the tolerance.
- **`invalid base64` on the secret.** Pass the whole `whsec_...` string. The function removes the prefix itself.
- **Returning 401 vs 400.** Any 4xx makes SignatureAPI retry, which is fine for a bad signature. Return 2xx only after you verified.

## Learn more

- [Webhooks](https://signatureapi.com/docs/api/webhooks)
- [Event object](https://signatureapi.com/docs/api/resources/events/object)
- [Webhook endpoints per framework](../../webhooks)
- [Standard Webhooks specification](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)
