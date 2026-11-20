# Send, track and download e-signature envelopes in Ruby

## The problem

You want to send a contract for e-signature from a Ruby backend without an SDK, and you want to see every request your code makes. Three small programs cover the core loop: send a document, check its status, and download the signed PDF.

## What you build

| Program | What it does | API call |
|---|---|---|
| `send_envelope.rb` | Sends the sample Service Agreement to one signer | `POST /v1/envelopes` |
| `get_status.rb` | Prints the envelope and recipient statuses | `GET /v1/envelopes/{id}` |
| `download_deliverable.rb` | Saves the signed PDF of a completed envelope | `GET /v1/deliverables/{id}` |

All three use `signatureapi_client.rb`, which holds the configuration, the request helper and the envelope builder. It uses `Net::HTTP` from the standard library.

## Prerequisites

- Ruby 3.1 or newer (tested on 3.3). No gems: the scripts use `net/http` and `json` from the standard library.
- A SignatureAPI test API key (it starts with `key_test_`). [Sign up](https://accounts.signatureapi.com/sign-up) to get one for free. Test envelopes have no legal effect and cost nothing.

## Step by step

1. **Configure the key.** The programs read `SIGNATUREAPI_KEY` from the environment and refuse any key that does not start with `key_test_`, so a copy-paste mistake never sends a live envelope. `SIGNATUREAPI_BASE_URL` is optional and defaults to `https://api.signatureapi.com`.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Build the envelope.** One document, one signer. The sample PDF has no `[[placeholders]]`, so the signature place is positioned with `fixed_positions`: `top` and `left` are points from the top and left edges of page 1 to the bottom-left corner of the place. The place's `recipient_key` matches the recipient's `key`. That link tells SignatureAPI who signs where.

   ```ruby
     # A one-signer envelope for the sample Service Agreement.
     # The sample PDF has no [[placeholders]], so the signature place uses fixed positions (points, page 1).
     def self.build_service_agreement(name: "Jane Doe", email: "jane.doe@example.com")
       {
         title: "Service Agreement",
         message: "Hi, please review and sign the Acme Corp Service Agreement.",
         metadata: {},
         documents: [{
           url: SAMPLE_PDF_URL,
           format: "pdf",
           places: [{ key: "client_signature", type: "signature", recipient_key: "client" }],
           fixed_positions: [{ place_key: "client_signature", page: 1, top: 172, left: 210 }]
         }],
         recipients: [{ key: "client", type: "signer", name: name, email: email }]
       }
     end
   ```

3. **Send it.** The send program posts the payload to `POST /v1/envelopes` with the `X-API-Key` header. The response is the full envelope: its id (a UUID) and the recipient statuses.

4. **Track it.** The status program reads `GET /v1/envelopes/{id}`. In production prefer [webhooks](../../webhooks) over polling. Use status reads for on-demand checks and reconciliation.

5. **Download the signed PDF.** Once the envelope is `completed`, its `deliverable` is generated. The download program reads the envelope, then `GET /v1/deliverables/{id}`, then fetches the deliverable's pre-signed `url` (valid for 1 hour). It does not send your API key to that URL.

## Run it

```bash
export SIGNATUREAPI_KEY=key_test_YOUR_KEY
ruby send_envelope.rb "Jane Doe" jane.doe@example.com
ruby get_status.rb eb4cf433-a8af-4161-b37b-7ef57d423e56
ruby download_deliverable.rb eb4cf433-a8af-4161-b37b-7ef57d423e56 signed.pdf
```

Run the status and download commands with the id printed by the first one. The download needs an envelope in the `completed` status. Test mode does not email the signer: open the envelope in the [dashboard](https://dashboard.signatureapi.com), preview the email and sign as Jane to complete it.

## Expected output

```text
$ ruby send_envelope.rb "Jane Doe" jane.doe@example.com
Envelope created: eb4cf433-a8af-4161-b37b-7ef57d423e56
Status: processing
Recipient client: Jane Doe <jane.doe@example.com> (pending)

$ ruby get_status.rb eb4cf433-a8af-4161-b37b-7ef57d423e56
Envelope eb4cf433-a8af-4161-b37b-7ef57d423e56: in_progress
  client (signer): sent

$ ruby download_deliverable.rb eb4cf433-a8af-4161-b37b-7ef57d423e56 signed.pdf
Saved deliverable del_5hN8sD2jKq7WxZ4mPv9Ta3 to signed.pdf (48213 bytes)
```

## Run the tests

```bash
ruby test_scripts.rb
```

The offline tests start a small HTTP server on a `TCPServer` socket in a background thread of the test process. They check every request: method, path, `X-API-Key` header and body. The send body is compared with `expected-envelope.json`, which matches the `CreateEnvelope` schema in the [OpenAPI spec](https://signatureapi.com/docs/api/openapi). They also check that the download never sends your API key to the pre-signed URL.

Real output:

```text
Running:

....S.

Finished in 0.006793s, 883.3077 runs/s, 2797.1410 assertions/s.

6 runs, 19 assertions, 0 failures, 0 errors, 1 skips
```

With `SIGNATUREAPI_KEY` set, the live test also creates a test-mode envelope and reads it back. Without the key it is skipped, as above.

The offline tests ran in the pinned official image `ruby@sha256:db3ad6dd68a886d51a187fb9bf486052f2976cdbe3b750169c25092aba1297fa` (`ruby:3.3-slim`).

## Troubleshooting

- **`401 Unauthorized`**: the key is missing, mistyped or revoked. Copy it again from the dashboard.
- **`422 Unprocessable Entity`**: the payload breaks a rule. The error body lists each problem with a pointer to the field, and the programs print it. A common cause is a `recipient_key` that matches no recipient.
- **"These examples run in test mode only"**: the key does not start with `key_test_`. Use a test key.
- **"Envelope is in_progress"** when downloading: the deliverable exists only after every recipient finishes. Sign in the test ceremony first.
- **Download returns 403**: the pre-signed URL expired after 1 hour. Run the program again to get a fresh one.
- **`SSL_connect returned=1 errno=0 ... certificate verify failed`**: the container or machine has no CA bundle. Install `ca-certificates`.

## Learn more

- [Quickstart](https://signatureapi.com/docs/api/guides/quickstart)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Place positioning](https://signatureapi.com/docs/api/resources/places/positioning)
- [Deliverables](https://signatureapi.com/docs/api/resources/deliverables/object)
- [Test mode](https://signatureapi.com/docs/api/test-mode)
- [Errors](https://signatureapi.com/docs/api/errors)
