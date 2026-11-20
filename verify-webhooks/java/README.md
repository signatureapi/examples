# Verify SignatureAPI webhook signatures in Java

## The problem

SignatureAPI sends events such as `envelope.completed` to your webhook endpoint. Anyone who knows your URL can post to it. You must check the signature before you trust a delivery. A wrong check either rejects real events or accepts forged ones.

## What you build

A single function, `WebhookVerifier.verify(secret, headers, rawBody, nowSeconds, toleranceSeconds)`, that implements [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md#verifying-webhook-authenticity) verification with the Java standard library only. It returns normally when the delivery is authentic and fails when it is not. A test runs every case in the shared [`test-vector.json`](../test-vector.json), and a small command line demo verifies one delivery.

## Prerequisites

- JDK 17 or newer (tested on 21). No libraries.
- The signing secret of your webhook endpoint (`whsec_...`). Find it in the [dashboard](https://dashboard.signatureapi.com/settings/webhooks).

## Step by step

1. **Collect three headers.** Every delivery carries `webhook-id`, `webhook-timestamp` (Unix seconds) and `webhook-signature`. If one is missing, reject the request. Header names are case-insensitive, so the code lowercases them first.
2. **Check the timestamp.** Reject a delivery whose timestamp is more than 5 minutes from your clock. This blocks replays of captured requests.
3. **Compute the expected signature.** Decode the secret (drop the `whsec_` prefix, base64-decode the rest). Compute HMAC-SHA256 over `<webhook-id>.<webhook-timestamp>.<raw body>`.
4. **Compare in constant time.** The `webhook-signature` header holds one or more space-separated entries such as `v1,<base64>`. A delivery is authentic if any `v1` entry equals the expected value. Use the language's constant-time comparison, never `==`.
5. **Pass the raw body.** The signature covers the exact bytes SignatureAPI sent. In Spring bind `@RequestBody byte[]`, not a DTO. In a servlet read `request.getInputStream().readAllBytes()`.

The core of the Java implementation (`WebhookVerifier.java`):

```java
  /**
   * Returns normally when the delivery is authentic, otherwise throws VerificationException.
   *
   * @param secret signing secret, "whsec_&lt;base64 key&gt;"
   * @param headers request headers (names matched case-insensitively)
   * @param rawBody the exact bytes received, never a re-serialized object
   * @param nowSeconds reference time as Unix seconds (use System.currentTimeMillis() / 1000)
   */
  public static void verify(
      String secret,
      Map<String, String> headers,
      byte[] rawBody,
      long nowSeconds,
      long toleranceSeconds)
      throws VerificationException {
    Map<String, String> lower = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
    lower.putAll(headers);
    String id = lower.get("webhook-id");
    String timestamp = lower.get("webhook-timestamp");
    String signatureHeader = lower.get("webhook-signature");
    if (isEmpty(id) || isEmpty(timestamp) || isEmpty(signatureHeader)) {
      throw new VerificationException(
          "Missing webhook-id, webhook-timestamp or webhook-signature header");
    }
    if (!timestamp.matches("\\d{1,18}")) {
      throw new VerificationException("Invalid webhook-timestamp");
    }
    if (Math.abs(nowSeconds - Long.parseLong(timestamp)) > toleranceSeconds) {
      throw new VerificationException("Timestamp outside the tolerance window");
    }

    byte[] expected;
    try {
      byte[] key = Base64.getDecoder().decode(secret.replaceFirst("^whsec_", ""));
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(key, "HmacSHA256"));
      mac.update((id + "." + timestamp + ".").getBytes(StandardCharsets.UTF_8));
      expected = mac.doFinal(rawBody);
    } catch (Exception e) {
      throw new VerificationException("Cannot compute signature: " + e.getMessage());
    }

    // The header holds space-separated "v1,<base64>" entries. Any match is enough.
    for (String entry : signatureHeader.split(" ")) {
      String[] parts = entry.split(",", 2);
      if (parts.length != 2 || !parts[0].equals("v1")) {
        continue;
      }
      try {
        byte[] candidate = Base64.getDecoder().decode(parts[1]);
        if (MessageDigest.isEqual(candidate, expected)) {
          return;
        }
      } catch (IllegalArgumentException ignored) {
        // Not base64: try the next entry.
      }
    }
    throw new VerificationException("No matching signature");
  }
```

## Run it

```bash
cd java
SIGNATUREAPI_WEBHOOK_SECRET=whsec_xxxxxxxx javac -d out *.java && java -cp out VerifyCli path/to/delivery.json
```

`delivery.json` holds `{"headers": {...}, "body": "..."}`. Without a path, the demo checks the valid case from the shared test vector, using the vector's fixed clock.

No Java toolchain installed? Run it in the official image. Mount the parent folder so the shared test vector is visible:

```bash
docker run --rm -v "$PWD/..":/app -w /app/java eclipse-temurin:21-jdk sh -c 'javac -d out *.java && java -cp out VerifyTest'
```

## Expected output

```text
$ javac -d out *.java && java -cp out VerifyCli
valid signature
```

For a forged delivery the demo prints `invalid: No matching signature` to stderr and exits with code 1.

## Run the tests

```bash
cd java
javac -d out *.java && java -cp out VerifyTest
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

Tested with `eclipse-temurin@sha256:db5cc6341a1d7bc40cdb51e1f0d9824f3bb2cc8107d29da421dc4df7d11f05f1`.
