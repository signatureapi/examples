# Verify SignatureAPI webhook signatures

Copy-paste webhook signature verification for seven languages. Each version uses the standard library only, passes the same test vector, and ships a short command line demo.

## The algorithm

SignatureAPI signs every webhook delivery with [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md#verifying-webhook-authenticity). To verify one:

1. Read the headers `webhook-id`, `webhook-timestamp` and `webhook-signature`. Reject the request if any is missing.
2. Reject the request if `webhook-timestamp` (Unix seconds) is more than 5 minutes away from your clock.
3. Take your signing secret (`whsec_<base64 key>`), drop the `whsec_` prefix and base64-decode the rest into the key.
4. Compute `HMAC-SHA256(key, "<webhook-id>.<webhook-timestamp>.<raw body>")`.
5. The `webhook-signature` header is a space-separated list of `v1,<base64>` entries. Compare each with the base64 of your result in constant time. One match means the delivery is authentic.

The body in step 4 is the exact bytes SignatureAPI sent. If you parse the JSON and serialize it again, the bytes change and the check fails. Always verify first, parse second.

## Pick your language

| Language | Folder | Test command |
|---|---|---|
| Node.js | [`node/`](node/README.md) | `node --test` |
| Python | [`python/`](python/README.md) | `python3 -m unittest -v` |
| PHP | [`php/`](php/README.md) | `php test.php` |
| Ruby | [`ruby/`](ruby/README.md) | `ruby test_verify_webhook.rb` |
| Go | [`go/`](go/README.md) | `go test -v ./...` |
| Java | [`java/`](java/README.md) | `javac -d out *.java && java -cp out VerifyTest` |
| C# | [`csharp/`](csharp/README.md) | `dotnet run` |

## The shared test vector

[`test-vector.json`](test-vector.json) holds a public test secret, a fixed clock (`now`) and six cases: `valid`, `valid_with_multiple_signatures`, `tampered_body`, `wrong_secret_signature`, `timestamp_too_old` and `missing_headers`. Every language runs all six. The secret is a test value, never a real signing secret.

## Next step

Wire the function into a real endpoint with the [framework examples](../webhooks): Express, Next.js, FastAPI, Django, Laravel, Rails, Spring Boot and ASP.NET Core.

## Learn more

- [Webhooks](https://signatureapi.com/docs/api/webhooks)
- [Event object](https://signatureapi.com/docs/api/resources/events/object)
