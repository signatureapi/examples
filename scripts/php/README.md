# Send, track and download e-signature envelopes in PHP

## The problem

You want to send a contract for e-signature from a PHP backend without an SDK, and you want to see every request your code makes. Three small programs cover the core loop: send a document, check its status, and download the signed PDF.

## What you build

| Program | What it does | API call |
|---|---|---|
| `send_envelope.php` | Sends the sample Service Agreement to one signer | `POST /v1/envelopes` |
| `get_status.php` | Prints the envelope and recipient statuses | `GET /v1/envelopes/{id}` |
| `download_deliverable.php` | Saves the signed PDF of a completed envelope | `GET /v1/deliverables/{id}` |

All three use `signatureapi.php`, which holds the configuration, the request helper and the envelope builder. It uses PHP streams (`file_get_contents` with a stream context), so no cURL extension is needed.

## Prerequisites

- PHP 8.1 or newer (tested on 8.3). No extensions beyond the defaults, no Composer packages.
- A SignatureAPI test API key (it starts with `key_test_`). [Sign up](https://accounts.signatureapi.com/sign-up) to get one for free. Test envelopes have no legal effect and cost nothing.

## Step by step

1. **Configure the key.** The programs read `SIGNATUREAPI_KEY` from the environment and refuse any key that does not start with `key_test_`, so a copy-paste mistake never sends a live envelope. `SIGNATUREAPI_BASE_URL` is optional and defaults to `https://api.signatureapi.com`.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Build the envelope.** One document, one signer. The sample PDF has no `[[placeholders]]`, so the signature place is positioned with `fixed_positions`: `top` and `left` are points from the top and left edges of page 1 to the bottom-left corner of the place. The place's `recipient_key` matches the recipient's `key`. That link tells SignatureAPI who signs where.

   ```php
   /** A one-signer envelope for the sample Service Agreement. The sample PDF has no [[placeholders]], so the place uses fixed positions (points, page 1). */
   function build_service_agreement(string $name = 'Jane Doe', string $email = 'jane.doe@example.com'): array
   {
       return [
           'title' => 'Service Agreement',
           'message' => 'Hi, please review and sign the Acme Corp Service Agreement.',
           'metadata' => new stdClass(),
           'documents' => [[
               'url' => SIGNATUREAPI_SAMPLE_PDF_URL,
               'format' => 'pdf',
               'places' => [['key' => 'client_signature', 'type' => 'signature', 'recipient_key' => 'client']],
               'fixed_positions' => [['place_key' => 'client_signature', 'page' => 1, 'top' => 172, 'left' => 210]],
           ]],
           'recipients' => [['key' => 'client', 'type' => 'signer', 'name' => $name, 'email' => $email]],
       ];
   }
   ```

3. **Send it.** The send program posts the payload to `POST /v1/envelopes` with the `X-API-Key` header. The response is the full envelope: its id (a UUID) and the recipient statuses.

4. **Track it.** The status program reads `GET /v1/envelopes/{id}`. In production prefer [webhooks](../../webhooks) over polling. Use status reads for on-demand checks and reconciliation.

5. **Download the signed PDF.** Once the envelope is `completed`, its `deliverable` is generated. The download program reads the envelope, then `GET /v1/deliverables/{id}`, then fetches the deliverable's pre-signed `url` (valid for 1 hour). It does not send your API key to that URL.

## Run it

```bash
export SIGNATUREAPI_KEY=key_test_YOUR_KEY
php send_envelope.php "Jane Doe" jane.doe@example.com
php get_status.php eb4cf433-a8af-4161-b37b-7ef57d423e56
php download_deliverable.php eb4cf433-a8af-4161-b37b-7ef57d423e56 signed.pdf
```

Run the status and download commands with the id printed by the first one. The download needs an envelope in the `completed` status. Test mode does not email the signer: open the envelope in the [dashboard](https://dashboard.signatureapi.com), preview the email and sign as Jane to complete it.

## Expected output

```text
$ php send_envelope.php "Jane Doe" jane.doe@example.com
Envelope created: eb4cf433-a8af-4161-b37b-7ef57d423e56
Status: processing
Recipient client: Jane Doe <jane.doe@example.com> (pending)

$ php get_status.php eb4cf433-a8af-4161-b37b-7ef57d423e56
Envelope eb4cf433-a8af-4161-b37b-7ef57d423e56: in_progress
  client (signer): sent

$ php download_deliverable.php eb4cf433-a8af-4161-b37b-7ef57d423e56 signed.pdf
Saved deliverable del_5hN8sD2jKq7WxZ4mPv9Ta3 to signed.pdf (48213 bytes)
```

## Run the tests

```bash
php test.php
```

The offline tests start a PHP built-in server (`php -S`) running `mock_router.php`, which logs every request to a file the test reads. They check every request: method, path, `X-API-Key` header and body. The send body is compared with `expected-envelope.json`, which matches the `CreateEnvelope` schema in the [OpenAPI spec](https://signatureapi.com/docs/api/openapi). They also check that the download never sends your API key to the pre-signed URL.

Real output:

```text
ok   - config requires a key
ok   - config refuses live keys
ok   - config trims the base URL
ok   - send: returns the envelope id
ok   - send: POST /v1/envelopes with the API key
ok   - send: body matches expected-envelope.json
ok   - get: GET /v1/envelopes/{id} with the API key
ok   - download: saves a PDF
ok   - download: calls envelope, deliverable, then the signed URL
ok   - download: never sends the API key to the signed URL
ok   - 401 raises SignatureApiException
skip - live test: SIGNATUREAPI_KEY is not set
11 passed, 0 failed, 1 skipped
```

With `SIGNATUREAPI_KEY` set, the live test also creates a test-mode envelope and reads it back. Without the key it is skipped, as above.

The offline tests ran in the pinned official image `php@sha256:628102249d93494233b54490b785f12db9cd60f4dc89416dfca15973f2125f10` (`php:8.3-cli`).

## Troubleshooting

- **`401 Unauthorized`**: the key is missing, mistyped or revoked. Copy it again from the dashboard.
- **`422 Unprocessable Entity`**: the payload breaks a rule. The error body lists each problem with a pointer to the field, and the programs print it. A common cause is a `recipient_key` that matches no recipient.
- **"These examples run in test mode only"**: the key does not start with `key_test_`. Use a test key.
- **"Envelope is in_progress"** when downloading: the deliverable exists only after every recipient finishes. Sign in the test ceremony first.
- **Download returns 403**: the pre-signed URL expired after 1 hour. Run the program again to get a fresh one.
- **`Could not reach ...`**: PHP could not open the connection. Check the network and `SIGNATUREAPI_BASE_URL`.

## Learn more

- [Quickstart](https://signatureapi.com/docs/api/guides/quickstart)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Place positioning](https://signatureapi.com/docs/api/resources/places/positioning)
- [Deliverables](https://signatureapi.com/docs/api/resources/deliverables/object)
- [Test mode](https://signatureapi.com/docs/api/test-mode)
- [Errors](https://signatureapi.com/docs/api/errors)
