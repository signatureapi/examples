# Go e-signature tutorial: send, embed and track a contract with webhooks

A complete Go app, standard library only, that sends a contract for signature, lets the user sign it inside your page (embedded ceremony), and tracks the result with verified webhooks.

## The problem

Most e-signature integrations need three things working together: a server call that creates the envelope, a signing experience that keeps users in your product, and a reliable way to learn when signing is done. Getting any one wrong leaks your API key, breaks the iframe, or trusts forged webhook calls.

## What you build

A small web app (`main.go`, about 175 lines, and `signatureapi.go` with the API client, the envelope builder and the Standard Webhooks verifier; `net/http` only, no third-party modules):

| Route | Purpose |
|---|---|
| `GET /` | A page with a form and the ceremony iframe |
| `POST /api/contracts` | Creates the envelope on the server and returns the ceremony URL |
| `GET /api/contracts/{id}` | Confirms the envelope status on the server |
| `GET /api/contracts/{id}/signed.pdf` | Streams the signed PDF (the deliverable) through your server |
| `POST /webhooks/signatureapi` | Receives events, verifies the signature on the raw body, dedupes retries |

## Prerequisites

- Go 1.23 or newer, or Docker to run it without installing Go.
- A SignatureAPI test API key (`key_test_...`). [Sign up](https://accounts.signatureapi.com/sign-up) for free.
- For webhooks on your machine: a webhook endpoint in the [dashboard](https://dashboard.signatureapi.com/settings/webhooks) pointing at a public tunnel, or `npx signatureapi listen` from the [SignatureAPI CLI](https://signatureapi.com/docs/cli/webhooks), which forwards test events and saves the signing secret.

## Step by step

### 1. Create the envelope on your server

The browser never sees your API key. `POST /api/contracts` calls `createSigningSession()`, which builds the envelope with `buildContract()` and sets three recipient options for embedding:

```go
"recipients": []any{map[string]any{
	"key": "client", "type": "signer", "name": name, "email": email,
	"delivery_type": "none", // your app shows the result; no emails
	"ceremony": map[string]any{
		"authentication": []any{map[string]any{"type": "custom", "provider": "Acme Corp Portal", "data": map[string]any{"user_id": userID}}},
		"embeddable_in":  []any{appOrigin}, // the origin allowed to frame the ceremony
	},
}},
```

`custom` authentication records that your app already signed the user in, so the ceremony URL comes back in the response at `recipients[0].ceremony.url`.

The envelope starts in `processing`, and the ceremony opens only once it is `in_progress`. `createSigningSession()` reads the envelope once a second until then and returns the ceremony URL from that read.

### 2. Embed the ceremony

`index.html` (embedded into the binary with `go:embed`) adds the two required query parameters and loads the URL in an iframe:

```js
src.searchParams.set('embedded', 'true');
src.searchParams.set('event_delivery', 'message');
```

It accepts `message` events only when `event.origin` is `https://sign.signatureapi.com` and `event.source` is the iframe. A `ceremony.completed` message is a UI signal, so the page then asks your server for the real status.

### 3. Verify webhooks on the raw body

SignatureAPI signs each delivery with the [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks) scheme. `verifyWebhook()` computes an HMAC-SHA256 over `webhook-id.webhook-timestamp.body` with your signing secret, compares in constant time with `hmac.Equal`, and rejects timestamps older than 5 minutes. The handler runs it on the bytes `io.ReadAll` returns, the exact bytes received: decoding and re-encoding the JSON first changes the bytes and breaks the signature.

### 4. Make the handler idempotent

Deliveries retry for up to 48 hours and can arrive out of order. The handler remembers each `webhook-id` and answers duplicates with `200` without processing them again. In production, store the ids in your database with a unique index.

### 5. Download the signed PDF

When the envelope completes, SignatureAPI generates the deliverable: the signed PDF with its audit log. `downloadSignedPDF()` reads the envelope, gets its deliverable, and downloads the file from the deliverable's `url`. That URL is pre-signed and expires after 1 hour, so the app requests a fresh one on each download instead of storing it, and sends no API key to it. Until the deliverable is generated, the route answers `409` and the page can try again a few seconds later.

## Run it

```bash
export SIGNATUREAPI_KEY=key_test_YOUR_KEY
export SIGNATUREAPI_WEBHOOK_SECRET=whsec_...   # from the webhook endpoint in the dashboard
export APP_ORIGIN=http://localhost:8080
go run .
```

The app listens on port 8080. To run it in Docker instead:

```bash
docker run --rm -p 8080:8080 -e SIGNATUREAPI_KEY -e SIGNATUREAPI_WEBHOOK_SECRET -e APP_ORIGIN \
  -v "$PWD/../..":/repo -w /repo/tutorials/go golang:1.23 go run .
```

Open http://localhost:8080, keep the sample name and email, and select **Start signing**.

## Expected output

```text
listening on :8080
webhook recipient.completed for envelope eb4cf433-a8af-4161-b37b-7ef57d423e56
webhook envelope.completed for envelope eb4cf433-a8af-4161-b37b-7ef57d423e56
```

After signing, the page shows `Thanks! Envelope status: completed`.

## Run the tests

```bash
go test -v ./...
```

The tests run the shared webhook [test vector](../../verify-webhooks/test-vector.json) through the verifier, then drive the handler with `httptest` against a local mock API and check the envelope payload, the 422 path, webhook acceptance, tamper rejection, duplicate handling and the PDF download. With `SIGNATUREAPI_KEY` set, live tests create a real embedded-ceremony envelope in test mode and download the signed PDF of an automatic-signer envelope.

## Troubleshooting

- **The iframe is blank or refuses to load**: `embeddable_in` must match your page's origin exactly (scheme, host and port), and the URL needs `embedded=true`.
- **No `message` events arrive**: add `event_delivery=message` to the URL, and check that your origin filter uses `https://sign.signatureapi.com`.
- **Every webhook returns 400 `invalid signature`**: wrong secret (each endpoint has its own), or a proxy changed the body before verification.
- **`timestamp outside the tolerance window`**: your server clock is off. Sync it with NTP.
- **`ceremonyUrl` is null**: the recipient is not using `custom` authentication. With `email_link`, SignatureAPI emails the link instead.

## Learn more

- [Embed signing in a web app](https://signatureapi.com/docs/api/guides/how-to/embed-web)
- [Ceremony events](https://signatureapi.com/docs/embedded/ceremony-events)
- [Webhooks](https://signatureapi.com/docs/api/webhooks)
- [Custom authentication](https://signatureapi.com/docs/api/guides/how-to/custom-authentication)
- [Verify webhook signatures in other languages](../../verify-webhooks)
