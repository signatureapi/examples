# Verify SignatureAPI webhook signatures in Go

## The problem

SignatureAPI sends events such as `envelope.completed` to your webhook endpoint. Anyone who knows your URL can post to it. You must check the signature before you trust a delivery. A wrong check either rejects real events or accepts forged ones.

## What you build

A single function, `verifywebhooks.Verify(secret, headers, rawBody, now, tolerance)`, that implements [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md#verifying-webhook-authenticity) verification with the Go standard library only. It returns normally when the delivery is authentic and fails when it is not. A test runs every case in the shared [`test-vector.json`](../test-vector.json), and a small command line demo verifies one delivery.

## Prerequisites

- Go 1.23 or newer. Standard library only.
- The signing secret of your webhook endpoint (`whsec_...`). Find it in the [dashboard](https://dashboard.signatureapi.com/settings/webhooks).

## Step by step

1. **Collect three headers.** Every delivery carries `webhook-id`, `webhook-timestamp` (Unix seconds) and `webhook-signature`. If one is missing, reject the request. Header names are case-insensitive, so the code lowercases them first.
2. **Check the timestamp.** Reject a delivery whose timestamp is more than 5 minutes from your clock. This blocks replays of captured requests.
3. **Compute the expected signature.** Decode the secret (drop the `whsec_` prefix, base64-decode the rest). Compute HMAC-SHA256 over `<webhook-id>.<webhook-timestamp>.<raw body>`.
4. **Compare in constant time.** The `webhook-signature` header holds one or more space-separated entries such as `v1,<base64>`. A delivery is authentic if any `v1` entry equals the expected value. Use the language's constant-time comparison, never `==`.
5. **Pass the raw body.** The signature covers the exact bytes SignatureAPI sent. Use `io.ReadAll(r.Body)` and pass those bytes. Do not decode into a struct and marshal it back.

The core of the Go implementation (`verify.go`):

```go
// Verify checks the delivery. It returns nil when authentic.
//
// secret is "whsec_<base64 key>". headers is matched case-insensitively. rawBody must be the
// exact bytes received, never a re-serialized object. now is the reference time; use time.Now().
func Verify(secret string, headers map[string]string, rawBody []byte, now time.Time, tolerance time.Duration) error {
	lower := make(map[string]string, len(headers))
	for name, value := range headers {
		lower[strings.ToLower(name)] = value
	}
	id, timestamp, signatureHeader := lower["webhook-id"], lower["webhook-timestamp"], lower["webhook-signature"]
	if id == "" || timestamp == "" || signatureHeader == "" {
		return fail("missing webhook-id, webhook-timestamp or webhook-signature header")
	}
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || seconds < 0 {
		return fail("invalid webhook-timestamp")
	}
	diff := now.Sub(time.Unix(seconds, 0))
	if diff < 0 {
		diff = -diff
	}
	if diff > tolerance {
		return fail("timestamp outside the tolerance window")
	}

	key, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, "whsec_"))
	if err != nil {
		return fail("secret is not valid base64")
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id + "." + timestamp + "."))
	mac.Write(rawBody)
	expected := mac.Sum(nil)

	// The header holds space-separated "v1,<base64>" entries. Any match is enough.
	for _, entry := range strings.Fields(signatureHeader) {
		version, signature, ok := strings.Cut(entry, ",")
		if !ok || version != "v1" {
			continue
		}
		candidate, err := base64.StdEncoding.DecodeString(signature)
		if err == nil && hmac.Equal(candidate, expected) {
			return nil
		}
	}
	return fail("no matching signature")
}
```

## Run it

```bash
cd go
SIGNATUREAPI_WEBHOOK_SECRET=whsec_xxxxxxxx go run ./cmd/verify path/to/delivery.json
```

`delivery.json` holds `{"headers": {...}, "body": "..."}`. Without a path, the demo checks the valid case from the shared test vector, using the vector's fixed clock.

No Go toolchain installed? Run it in the official image. Mount the parent folder so the shared test vector is visible:

```bash
docker run --rm -v "$PWD/..":/app -w /app/go golang:1.23 sh -c 'go test -v ./...'
```

## Expected output

```text
$ go run ./cmd/verify
valid signature
```

For a forged delivery the demo prints `invalid: No matching signature` to stderr and exits with code 1.

## Run the tests

```bash
cd go
go test -v ./...
```

Real output:

```text
--- PASS: TestVector (0.00s)
    --- PASS: TestVector/valid (0.00s)
    --- PASS: TestVector/valid_with_multiple_signatures (0.00s)
    --- PASS: TestVector/tampered_body (0.00s)
    --- PASS: TestVector/wrong_secret_signature (0.00s)
    --- PASS: TestVector/timestamp_too_old (0.00s)
    --- PASS: TestVector/missing_headers (0.00s)
--- PASS: TestHeaderNamesAreCaseInsensitive (0.00s)
PASS
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

Tested with `golang@sha256:60deed95d3888cc5e4d9ff8a10c54e5edc008c6ae3fba6187be6fb592e19e8c0`.
