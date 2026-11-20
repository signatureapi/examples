# Verify SignatureAPI webhook signatures in Ruby

## The problem

SignatureAPI sends events such as `envelope.completed` to your webhook endpoint. Anyone who knows your URL can post to it. You must check the signature before you trust a delivery. A wrong check either rejects real events or accepts forged ones.

## What you build

A single function, `SignatureApi.verify_webhook(secret, headers, raw_body, now:)`, that implements [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md#verifying-webhook-authenticity) verification with the Ruby standard library only. It returns normally when the delivery is authentic and fails when it is not. A test runs every case in the shared [`test-vector.json`](../test-vector.json), and a small command line demo verifies one delivery.

## Prerequisites

- Ruby 3.1 or newer (tested on 3.3). No gems.
- The signing secret of your webhook endpoint (`whsec_...`). Find it in the [dashboard](https://dashboard.signatureapi.com/settings/webhooks).

## Step by step

1. **Collect three headers.** Every delivery carries `webhook-id`, `webhook-timestamp` (Unix seconds) and `webhook-signature`. If one is missing, reject the request. Header names are case-insensitive, so the code lowercases them first.
2. **Check the timestamp.** Reject a delivery whose timestamp is more than 5 minutes from your clock. This blocks replays of captured requests.
3. **Compute the expected signature.** Decode the secret (drop the `whsec_` prefix, base64-decode the rest). Compute HMAC-SHA256 over `<webhook-id>.<webhook-timestamp>.<raw body>`.
4. **Compare in constant time.** The `webhook-signature` header holds one or more space-separated entries such as `v1,<base64>`. A delivery is authentic if any `v1` entry equals the expected value. Use the language's constant-time comparison, never `==`.
5. **Pass the raw body.** The signature covers the exact bytes SignatureAPI sent. In Rails use `request.raw_post`. In Sinatra use `request.body.read`. Never pass `params.to_json`.

The core of the Ruby implementation (`verify_webhook.rb`):

```ruby
  # Verify a Standard Webhooks signature. Returns true or raises WebhookVerificationError.
  #
  # headers:  Hash of request headers (names matched case-insensitively).
  # raw_body: the exact bytes received. Never a re-serialized object.
  # now:      Unix seconds, defaults to the clock.
  def self.verify_webhook(secret, headers, raw_body, now: Time.now.to_i, tolerance_seconds: 300)
    lower = headers.to_h { |name, value| [name.to_s.downcase, value] }
    id = lower["webhook-id"]
    timestamp = lower["webhook-timestamp"]
    signature_header = lower["webhook-signature"]
    if [id, timestamp, signature_header].any? { |v| v.nil? || v.empty? }
      raise WebhookVerificationError, "Missing webhook-id, webhook-timestamp or webhook-signature header"
    end
    raise WebhookVerificationError, "Invalid webhook-timestamp" unless timestamp.match?(/\A\d+\z/)
    if (now - timestamp.to_i).abs > tolerance_seconds
      raise WebhookVerificationError, "Timestamp outside the tolerance window"
    end

    key = Base64.strict_decode64(secret.delete_prefix("whsec_"))
    expected = OpenSSL::HMAC.digest("SHA256", key, "#{id}.#{timestamp}.#{raw_body}")

    # The header holds space-separated "v1,<base64>" entries. Any match is enough.
    signature_header.split(" ").each do |entry|
      version, signature = entry.split(",", 2)
      next unless version == "v1" && signature

      candidate = begin
        Base64.strict_decode64(signature)
      rescue ArgumentError
        next
      end
      if candidate.bytesize == expected.bytesize && OpenSSL.fixed_length_secure_compare(candidate, expected)
        return true
      end
    end
    raise WebhookVerificationError, "No matching signature"
  end
```

## Run it

```bash
cd ruby
SIGNATUREAPI_WEBHOOK_SECRET=whsec_xxxxxxxx ruby verify_cli.rb path/to/delivery.json
```

`delivery.json` holds `{"headers": {...}, "body": "..."}`. Without a path, the demo checks the valid case from the shared test vector, using the vector's fixed clock.

No Ruby toolchain installed? Run it in the official image. Mount the parent folder so the shared test vector is visible:

```bash
docker run --rm -v "$PWD/..":/app -w /app/ruby ruby:3.3-slim sh -c 'ruby test_verify_webhook.rb'
```

## Expected output

```text
$ ruby verify_cli.rb
valid signature
```

For a forged delivery the demo prints `invalid: No matching signature` to stderr and exits with code 1.

## Run the tests

```bash
cd ruby
ruby test_verify_webhook.rb
```

Real output:

```text
Running:

.......

Finished in 0.001360s, 5148.6451 runs/s, 5148.6451 assertions/s.

7 runs, 7 assertions, 0 failures, 0 errors, 0 skips
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

Tested with `ruby@sha256:db3ad6dd68a886d51a187fb9bf486052f2976cdbe3b750169c25092aba1297fa`.
