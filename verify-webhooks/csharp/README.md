# Verify SignatureAPI webhook signatures in C#

## The problem

SignatureAPI sends events such as `envelope.completed` to your webhook endpoint. Anyone who knows your URL can post to it. You must check the signature before you trust a delivery. A wrong check either rejects real events or accepts forged ones.

## What you build

A single function, `WebhookVerifier.Verify(secret, headers, rawBody, nowSeconds, toleranceSeconds)`, that implements [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md#verifying-webhook-authenticity) verification with the C# standard library only. It returns normally when the delivery is authentic and fails when it is not. A test runs every case in the shared [`test-vector.json`](../test-vector.json), and a small command line demo verifies one delivery.

## Prerequisites

- .NET SDK 8.0 or newer. Base class library only.
- The signing secret of your webhook endpoint (`whsec_...`). Find it in the [dashboard](https://dashboard.signatureapi.com/settings/webhooks).

## Step by step

1. **Collect three headers.** Every delivery carries `webhook-id`, `webhook-timestamp` (Unix seconds) and `webhook-signature`. If one is missing, reject the request. Header names are case-insensitive, so the code lowercases them first.
2. **Check the timestamp.** Reject a delivery whose timestamp is more than 5 minutes from your clock. This blocks replays of captured requests.
3. **Compute the expected signature.** Decode the secret (drop the `whsec_` prefix, base64-decode the rest). Compute HMAC-SHA256 over `<webhook-id>.<webhook-timestamp>.<raw body>`.
4. **Compare in constant time.** The `webhook-signature` header holds one or more space-separated entries such as `v1,<base64>`. A delivery is authentic if any `v1` entry equals the expected value. Use the language's constant-time comparison, never `==`.
5. **Pass the raw body.** The signature covers the exact bytes SignatureAPI sent. In ASP.NET Core copy `Request.Body` into a `MemoryStream` and pass the bytes. Do not bind a model and serialize it again.

The core of the C# implementation (`WebhookVerifier.cs`):

```csharp
    /// <summary>
    /// Returns normally when the delivery is authentic, otherwise throws VerificationException.
    /// rawBody must be the exact bytes received, never a re-serialized object.
    /// </summary>
    public static void Verify(
        string secret,
        IDictionary<string, string> headers,
        byte[] rawBody,
        long nowSeconds,
        long toleranceSeconds = 300)
    {
        var lower = new Dictionary<string, string>(headers, StringComparer.OrdinalIgnoreCase);
        lower.TryGetValue("webhook-id", out var id);
        lower.TryGetValue("webhook-timestamp", out var timestamp);
        lower.TryGetValue("webhook-signature", out var signatureHeader);
        if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(timestamp) || string.IsNullOrEmpty(signatureHeader))
            throw new VerificationException("Missing webhook-id, webhook-timestamp or webhook-signature header");
        if (!long.TryParse(timestamp, out var seconds) || seconds < 0)
            throw new VerificationException("Invalid webhook-timestamp");
        if (Math.Abs(nowSeconds - seconds) > toleranceSeconds)
            throw new VerificationException("Timestamp outside the tolerance window");

        byte[] key;
        try
        {
            key = Convert.FromBase64String(secret.StartsWith("whsec_") ? secret["whsec_".Length..] : secret);
        }
        catch (FormatException)
        {
            throw new VerificationException("Secret is not valid base64");
        }
        using var hmac = new HMACSHA256(key);
        var prefix = Encoding.UTF8.GetBytes($"{id}.{timestamp}.");
        var expected = hmac.ComputeHash([.. prefix, .. rawBody]);

        // The header holds space-separated "v1,<base64>" entries. Any match is enough.
        foreach (var entry in signatureHeader.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = entry.Split(',', 2);
            if (parts.Length != 2 || parts[0] != "v1") continue;
            try
            {
                if (CryptographicOperations.FixedTimeEquals(Convert.FromBase64String(parts[1]), expected)) return;
            }
            catch (FormatException)
            {
                // Not base64: try the next entry.
            }
        }
        throw new VerificationException("No matching signature");
    }
```

## Run it

```bash
cd csharp
SIGNATUREAPI_WEBHOOK_SECRET=whsec_xxxxxxxx dotnet run -- demo path/to/delivery.json
```

`delivery.json` holds `{"headers": {...}, "body": "..."}`. Without a path, the demo checks the valid case from the shared test vector, using the vector's fixed clock.

No C# toolchain installed? Run it in the official image. Mount the parent folder so the shared test vector is visible:

```bash
docker run --rm -v "$PWD/..":/app -w /app/csharp mcr.microsoft.com/dotnet/sdk:8.0 sh -c 'dotnet run'
```

## Expected output

```text
$ dotnet run -- demo
valid signature
```

For a forged delivery the demo prints `invalid: No matching signature` to stderr and exits with code 1.

## Run the tests

```bash
cd csharp
dotnet run
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

Tested with `mcr.microsoft.com/dotnet/sdk@sha256:1b955f179b02df4f0eb5fadedaa898cbe44d620a64aab52eec72c8e91d1355b5`.
