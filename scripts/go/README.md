# Send, track and download e-signature envelopes in Go

## The problem

You want to send a contract for e-signature from a Go backend without an SDK, and you want to see every request your code makes. Three small programs cover the core loop: send a document, check its status, and download the signed PDF.

## What you build

| Program | What it does | API call |
|---|---|---|
| `cmd/send-envelope` | Sends the sample Service Agreement to one signer | `POST /v1/envelopes` |
| `cmd/get-status` | Prints the envelope and recipient statuses | `GET /v1/envelopes/{id}` |
| `cmd/download-deliverable` | Saves the signed PDF of a completed envelope | `GET /v1/deliverables/{id}` |

All three use `signatureapi/client.go`, which holds the configuration, the request helper and the envelope builder. It uses `net/http` from the standard library.

## Prerequisites

- Go 1.23 or newer. Standard library only, no `go get`.
- A SignatureAPI test API key (it starts with `key_test_`). [Sign up](https://accounts.signatureapi.com/sign-up) to get one for free. Test envelopes have no legal effect and cost nothing.

## Step by step

1. **Configure the key.** The programs read `SIGNATUREAPI_KEY` from the environment and refuse any key that does not start with `key_test_`, so a copy-paste mistake never sends a live envelope. `SIGNATUREAPI_BASE_URL` is optional and defaults to `https://api.signatureapi.com`.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Build the envelope.** One document, one signer. The sample PDF has no `[[placeholders]]`, so the signature place is positioned with `fixed_positions`: `top` and `left` are points from the top and left edges of page 1 to the bottom-left corner of the place. The place's `recipient_key` matches the recipient's `key`. That link tells SignatureAPI who signs where.

   ```go
   // BuildServiceAgreement builds a one-signer envelope for the sample Service Agreement.
   func BuildServiceAgreement(name, email string) map[string]any {
   	return map[string]any{
   		"title":    "Service Agreement",
   		"message":  "Hi, please review and sign the Acme Corp Service Agreement.",
   		"metadata": map[string]any{},
   		"documents": []any{map[string]any{
   			"url":    SamplePDFURL,
   			"format": "pdf",
   			"places": []any{map[string]any{"key": "client_signature", "type": "signature", "recipient_key": "client"}},
   			// top and left: points from the top and left edges of page 1 to the bottom-left corner of the place.
   			"fixed_positions": []any{map[string]any{"place_key": "client_signature", "page": 1, "top": 172, "left": 210}},
   		}},
   		"recipients": []any{map[string]any{"key": "client", "type": "signer", "name": name, "email": email}},
   	}
   }
   ```

3. **Send it.** The send program posts the payload to `POST /v1/envelopes` with the `X-API-Key` header. The response is the full envelope: its id (a UUID) and the recipient statuses.

4. **Track it.** The status program reads `GET /v1/envelopes/{id}`. In production prefer [webhooks](../../webhooks) over polling. Use status reads for on-demand checks and reconciliation.

5. **Download the signed PDF.** Once the envelope is `completed`, its `deliverable` is generated. The download program reads the envelope, then `GET /v1/deliverables/{id}`, then fetches the deliverable's pre-signed `url` (valid for 1 hour). It does not send your API key to that URL.

## Run it

```bash
export SIGNATUREAPI_KEY=key_test_YOUR_KEY
go run ./cmd/send-envelope "Jane Doe" jane.doe@example.com
go run ./cmd/get-status eb4cf433-a8af-4161-b37b-7ef57d423e56
go run ./cmd/download-deliverable eb4cf433-a8af-4161-b37b-7ef57d423e56 signed.pdf
```

Run the status and download commands with the id printed by the first one. The download needs an envelope in the `completed` status. Test mode does not email the signer: open the envelope in the [dashboard](https://dashboard.signatureapi.com), preview the email and sign as Jane to complete it.

## Expected output

```text
$ go run ./cmd/send-envelope "Jane Doe" jane.doe@example.com
Envelope created: eb4cf433-a8af-4161-b37b-7ef57d423e56
Status: processing
Recipient client: Jane Doe <jane.doe@example.com> (pending)

$ go run ./cmd/get-status eb4cf433-a8af-4161-b37b-7ef57d423e56
Envelope eb4cf433-a8af-4161-b37b-7ef57d423e56: in_progress
  client (signer): sent

$ go run ./cmd/download-deliverable eb4cf433-a8af-4161-b37b-7ef57d423e56 signed.pdf
Saved deliverable del_5hN8sD2jKq7WxZ4mPv9Ta3 to signed.pdf (48213 bytes)
```

## Run the tests

```bash
go test -v ./...
```

The offline tests start `net/http/httptest` inside the test binary. They check every request: method, path, `X-API-Key` header and body. The send body is compared with `expected-envelope.json`, which matches the `CreateEnvelope` schema in the [OpenAPI spec](https://signatureapi.com/docs/api/openapi). They also check that the download never sends your API key to the pre-signed URL.

Real output:

```text
--- PASS: TestFromEnv (0.00s)
--- PASS: TestSendEnvelope (0.00s)
--- PASS: TestGetEnvelope (0.00s)
--- PASS: TestDownloadDeliverableDoesNotLeakTheKey (0.00s)
--- PASS: TestUnauthorizedReturnsAPIError (0.00s)
    client_test.go:161: SIGNATUREAPI_KEY is not set: skipping the live test
--- SKIP: TestLive (0.00s)
PASS
```

With `SIGNATUREAPI_KEY` set, the live test also creates a test-mode envelope and reads it back. Without the key it is skipped, as above.

The offline tests ran in the pinned official image `golang@sha256:60deed95d3888cc5e4d9ff8a10c54e5edc008c6ae3fba6187be6fb592e19e8c0` (`golang:1.23`).

## Troubleshooting

- **`401 Unauthorized`**: the key is missing, mistyped or revoked. Copy it again from the dashboard.
- **`422 Unprocessable Entity`**: the payload breaks a rule. The error body lists each problem with a pointer to the field, and the programs print it. A common cause is a `recipient_key` that matches no recipient.
- **"These examples run in test mode only"**: the key does not start with `key_test_`. Use a test key.
- **"Envelope is in_progress"** when downloading: the deliverable exists only after every recipient finishes. Sign in the test ceremony first.
- **Download returns 403**: the pre-signed URL expired after 1 hour. Run the program again to get a fresh one.
- **`go: cannot find main module`**: run the commands from the `go/` folder, where `go.mod` lives.

## Learn more

- [Quickstart](https://signatureapi.com/docs/api/guides/quickstart)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Place positioning](https://signatureapi.com/docs/api/resources/places/positioning)
- [Deliverables](https://signatureapi.com/docs/api/resources/deliverables/object)
- [Test mode](https://signatureapi.com/docs/api/test-mode)
- [Errors](https://signatureapi.com/docs/api/errors)
