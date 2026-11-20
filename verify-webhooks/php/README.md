# Verify SignatureAPI webhook signatures in PHP

## The problem

SignatureAPI sends events such as `envelope.completed` to your webhook endpoint. Anyone who knows your URL can post to it. You must check the signature before you trust a delivery. A wrong check either rejects real events or accepts forged ones.

## What you build

A single function, `verifyWebhook($secret, $headers, $rawBody, $now)`, that implements [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md#verifying-webhook-authenticity) verification with the PHP standard library only. It returns normally when the delivery is authentic and fails when it is not. A test runs every case in the shared [`test-vector.json`](../test-vector.json), and a small command line demo verifies one delivery.

## Prerequisites

- PHP 8.1 or newer (tested on 8.3). No extensions beyond the defaults.
- The signing secret of your webhook endpoint (`whsec_...`). Find it in the [dashboard](https://dashboard.signatureapi.com/settings/webhooks).

## Step by step

1. **Collect three headers.** Every delivery carries `webhook-id`, `webhook-timestamp` (Unix seconds) and `webhook-signature`. If one is missing, reject the request. Header names are case-insensitive, so the code lowercases them first.
2. **Check the timestamp.** Reject a delivery whose timestamp is more than 5 minutes from your clock. This blocks replays of captured requests.
3. **Compute the expected signature.** Decode the secret (drop the `whsec_` prefix, base64-decode the rest). Compute HMAC-SHA256 over `<webhook-id>.<webhook-timestamp>.<raw body>`.
4. **Compare in constant time.** The `webhook-signature` header holds one or more space-separated entries such as `v1,<base64>`. A delivery is authentic if any `v1` entry equals the expected value. Use the language's constant-time comparison, never `==`.
5. **Pass the raw body.** The signature covers the exact bytes SignatureAPI sent. Read the body with `file_get_contents('php://input')`, not from `$_POST` or `json_encode($decoded)`. In Laravel use `$request->getContent()`.

The core of the PHP implementation (`verify.php`):

```php
/**
 * Verify a Standard Webhooks signature. Returns true or throws WebhookVerificationError.
 *
 * @param array<string, string> $headers Request headers (names matched case-insensitively).
 * @param string $rawBody The exact bytes received. Never a re-encoded JSON string.
 * @param int|null $now Unix seconds, defaults to the clock.
 */
function verifyWebhook(string $secret, array $headers, string $rawBody, ?int $now = null, int $toleranceSeconds = 300): bool
{
    $now ??= time();
    $lower = array_change_key_case($headers, CASE_LOWER);
    $id = $lower['webhook-id'] ?? '';
    $timestamp = $lower['webhook-timestamp'] ?? '';
    $signatureHeader = $lower['webhook-signature'] ?? '';
    if ($id === '' || $timestamp === '' || $signatureHeader === '') {
        throw new WebhookVerificationError('Missing webhook-id, webhook-timestamp or webhook-signature header');
    }
    if (!ctype_digit($timestamp)) {
        throw new WebhookVerificationError('Invalid webhook-timestamp');
    }
    if (abs($now - (int) $timestamp) > $toleranceSeconds) {
        throw new WebhookVerificationError('Timestamp outside the tolerance window');
    }

    $key = base64_decode(preg_replace('/^whsec_/', '', $secret), true);
    if ($key === false) {
        throw new WebhookVerificationError('Secret is not valid base64');
    }
    $expected = hash_hmac('sha256', "{$id}.{$timestamp}.{$rawBody}", $key, true);

    // The header holds space-separated "v1,<base64>" entries. Any match is enough.
    foreach (explode(' ', $signatureHeader) as $entry) {
        $parts = explode(',', $entry, 2);
        if (count($parts) !== 2 || $parts[0] !== 'v1') {
            continue;
        }
        $candidate = base64_decode($parts[1], true);
        if ($candidate !== false && hash_equals($expected, $candidate)) {
            return true;
        }
    }
    throw new WebhookVerificationError('No matching signature');
}
```

## Run it

```bash
cd php
SIGNATUREAPI_WEBHOOK_SECRET=whsec_xxxxxxxx php verify-cli.php path/to/delivery.json
```

`delivery.json` holds `{"headers": {...}, "body": "..."}`. Without a path, the demo checks the valid case from the shared test vector, using the vector's fixed clock.

No PHP toolchain installed? Run it in the official image. Mount the parent folder so the shared test vector is visible:

```bash
docker run --rm -v "$PWD/..":/app -w /app/php php:8.3-cli sh -c 'php test.php'
```

## Expected output

```text
$ php verify-cli.php
valid signature
```

For a forged delivery the demo prints `invalid: No matching signature` to stderr and exits with code 1.

## Run the tests

```bash
cd php
php test.php
```

Real output:

```text
ok   - test vector: valid
ok   - test vector: valid_with_multiple_signatures
ok   - test vector: tampered_body
ok   - test vector: wrong_secret_signature
ok   - test vector: timestamp_too_old
ok   - test vector: missing_headers
ok   - header names are case-insensitive
7 passed, 0 failed
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

Tested with `php@sha256:628102249d93494233b54490b785f12db9cd60f4dc89416dfca15973f2125f10`.
