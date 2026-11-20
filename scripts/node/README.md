# Send, track and download e-signature envelopes with Node.js

Four small, dependency-free Node.js scripts that cover the core SignatureAPI loop: send a document for signature, check its status, download the signed PDF, and send in bulk from a CSV file.

## The problem

You want to send a contract for e-signature from your backend without pulling in an SDK, and you want to see every request your code makes. Node.js 20 ships `fetch`, so a few lines of plain JavaScript are enough.

## What you build

| Script | What it does | API call |
|---|---|---|
| `send-envelope.mjs` | Sends the sample Service Agreement to one signer | `POST /v1/envelopes` |
| `get-status.mjs` | Prints the envelope and recipient statuses | `GET /v1/envelopes/{id}` |
| `download-deliverable.mjs` | Saves the signed PDF of a completed envelope | `GET /v1/deliverables/{id}` |
| `bulk-send-csv.mjs` | Sends one envelope per CSV row and reports each result | `POST /v1/envelopes` per row |

`lib.mjs` holds the shared pieces: configuration, a 30-line API helper, and the envelope builder.

## Prerequisites

- Node.js 20 or newer.
- A SignatureAPI test API key (it starts with `key_test_`). [Sign up](https://accounts.signatureapi.com/sign-up) to get one for free. Test envelopes have no legal effect and cost nothing.

## Step by step

1. **Configure the key.** The scripts read `SIGNATUREAPI_KEY` from the environment and refuse any key that does not start with `key_test_`, so a copy-paste mistake never sends a live envelope.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Build the envelope.** `buildServiceAgreement()` in `lib.mjs` describes one document and one signer. The sample PDF has no `[[placeholders]]`, so the signature place is positioned with `fixed_positions` (points from the top-left of page 1):

   ```js
   documents: [{
     url: 'https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf',
     format: 'pdf',
     places: [{ key: 'client_signature', type: 'signature', recipient_key: 'client' }],
     fixed_positions: [{ place_key: 'client_signature', page: 1, top: 172, left: 210 }],
   }],
   recipients: [{ key: 'client', type: 'signer', name: 'Jane Doe', email: 'jane.doe@example.com' }],
   ```

   The place's `recipient_key` matches the recipient's `key`. That link tells SignatureAPI who signs where.

3. **Send it.** `send-envelope.mjs` posts the payload with the `X-API-Key` header. The response is the full envelope, including its id (a UUID) and the recipient statuses.

4. **Track it.** `get-status.mjs <envelope-id>` reads the envelope. In production, prefer [webhooks](../../webhooks) over polling; use status reads for on-demand checks and reconciliation.

5. **Download the signed PDF.** Once the envelope is `completed`, its `deliverable` is generated. `download-deliverable.mjs` reads the deliverable, then fetches its pre-signed `url` (valid for 1 hour, no API key needed) and writes the file.

6. **Send in bulk.** `bulk-send-csv.mjs signers.csv` sends one envelope per row, one at a time with a short pause, and keeps going when a row fails. Each envelope carries `metadata.customer_ref` so webhook events map back to your records.

## Run it

```bash
node send-envelope.mjs "Jane Doe" jane.doe@example.com
node get-status.mjs <envelope-id>
node download-deliverable.mjs <envelope-id> signed.pdf
node bulk-send-csv.mjs signers.csv
```

## Expected output

```text
$ node send-envelope.mjs
Envelope created: eb4cf433-a8af-4161-b37b-7ef57d423e56
Status: processing
Recipient client: Jane Doe <jane.doe@example.com> (pending)

$ node get-status.mjs eb4cf433-a8af-4161-b37b-7ef57d423e56
Envelope eb4cf433-a8af-4161-b37b-7ef57d423e56: in_progress
  client (signer): sent

$ node bulk-send-csv.mjs signers.csv
row 1 jane.doe@example.com: sent eb4cf433-a8af-4161-b37b-7ef57d423e56
row 2 john.smith@example.com: sent 688d2c9f-5dbe-4bc4-bd0b-2e0459016be8
row 3 maria.garcia@example.com: sent 0c342ebb-de68-4291-a406-53b431b70f87
3 sent, 0 failed
```

Test mode does not email the signer. Open the envelope in the [dashboard](https://dashboard.signatureapi.com), preview the email, and sign as Jane to complete it.

## Run the tests

```bash
npm test
```

The offline tests start a local mock API and check every request: method, path, `X-API-Key` header and body. They also check that the script never sends your API key to the pre-signed download URL. With `SIGNATUREAPI_KEY` set, a live test also creates an envelope with an [automatic signer](https://signatureapi.com/docs/api/resources/recipients/automatic-signer) so it completes without a human, waits for the deliverable and downloads the real signed PDF. Without the key, the live tests are skipped.

## Troubleshooting

- **`401 Unauthorized`**: the key is missing, mistyped, or revoked. Copy it again from the dashboard.
- **`422 Unprocessable Entity`**: the payload breaks a rule. The error body lists each problem with a pointer to the field; the scripts print it. A common one is a `recipient_key` that matches no recipient.
- **`Envelope is in_progress`** when downloading: the deliverable exists only after every recipient finishes. Sign in the test ceremony first.
- **Download returns 403**: the pre-signed URL expired after 1 hour. Run the script again to get a fresh one.
- **`fetch is not defined`**: you are on Node.js 16 or older. Upgrade to Node.js 20.

## Learn more

- [Quickstart](https://signatureapi.com/docs/api/guides/quickstart)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Place positioning](https://signatureapi.com/docs/api/resources/places/positioning)
- [Deliverables](https://signatureapi.com/docs/api/resources/deliverables/object)
- [Test mode](https://signatureapi.com/docs/api/test-mode)
- [Errors](https://signatureapi.com/docs/api/errors)
