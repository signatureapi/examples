# Bulk-send placement agreements from a CSV and countersign automatically (Node.js)

Read candidates from a CSV, send one envelope each, and let the agency countersign automatically. Runs in test mode, needs no dependencies, and takes about a minute.

## The problem

A staffing agency onboards dozens of workers a week. Each one signs a placement agreement, and the agency countersigns every one of them. Chasing a human countersigner for each envelope is the bottleneck.

This example reads candidates from a CSV, creates one envelope per row, and uses an automatic signer so the agency countersignature is applied as soon as the envelope is created.

## What you build

A small Node.js script (`index.mjs`) with two parts:

- `buildEnvelope()`: a pure function that returns the `POST /v1/envelopes` request body. No network, no clock, so it is easy to test.
- `send()` and `main()`: send it with the built-in `fetch` and print a summary.

API features shown: Bulk send from a CSV, automatic signer countersignature, metadata, topics.

The envelope shape and why:

- **One envelope per CSV row.** SignatureAPI has no bulk endpoint. You loop over your records and call `POST /v1/envelopes` for each. A 200 ms pause between calls keeps you inside the rate limit.
- **Signer plus automatic signer.** The candidate is a `signer`. The agency is an `automatic_signer`: no email, no ceremony. You give it a signature image (uploaded once with `POST /v1/uploads`) and a `mandate` that records why you may sign on its behalf.
- **Two signature places.** The candidate signs the client line and the agency mark lands on the provider line. Both use `fixed_positions` on the sample PDF.
- **Correlation.** `metadata.record_id` is the CSV row id and `metadata.batch_id` names the wave, so you can reconcile envelopes with your list later. `topics` tag the batch.

## Prerequisites

- Node.js 20 or newer (uses the built-in `fetch` and `node:test`). No `npm install` needed.
- A SignatureAPI **test** API key. It starts with `key_test_`. Create one in the [dashboard](https://dashboard.signatureapi.com). The script refuses any other key.

## Step by step

1. **Set the key.** Export it. The script never prints it.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Prepare the CSV.** `candidates.csv` has one header row: `record_id,candidate_name,email,role,start_date`. `parseCsv()` handles quoted fields and returns one object per row.
3. **Upload the agency mark once.** `uploadMark()` sends the PNG bytes to `POST /v1/uploads` with `Content-Type: image/png` and returns a `url`. The mark is abstract and synthetic. Reuse the URL for every envelope in the batch (uploads expire after 24 hours).
4. **Build one payload per row.** `buildEnvelope(row)` creates the signer from the row and the automatic signer with `signature: { type: "drawn", url }` and a `mandate`.
5. **Send with a pause.** `send()` posts the envelopes one after another and waits between calls. Add error handling and a retry list in production.
6. **Send it.** `send()` calls `POST /v1/envelopes` with the `X-API-Key` header and returns the created envelope. A `201 Created` response carries the envelope `id` (a UUID) and its `recipients`.

The full request body this example sends (default values):

```json
{
  "title": "Placement Agreement - Jane Doe",
  "message": "Please sign your placement agreement for the Warehouse Associate role.",
  "routing": "sequential",
  "metadata": {
    "record_id": "cand_2001",
    "batch_id": "2026_11_wave_1"
  },
  "topics": [
    "staffing",
    "onboarding"
  ],
  "documents": [
    {
      "key": "placement_agreement",
      "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
      "format": "pdf",
      "fixed_positions": [
        {
          "place_key": "candidate_signature",
          "page": 1,
          "top": 172,
          "left": 210
        },
        {
          "place_key": "agency_countersignature",
          "page": 1,
          "top": 186,
          "left": 220
        }
      ],
      "places": [
        {
          "key": "candidate_signature",
          "type": "signature",
          "recipient_key": "candidate"
        },
        {
          "key": "agency_countersignature",
          "type": "signature",
          "recipient_key": "agency"
        }
      ]
    }
  ],
  "recipients": [
    {
      "type": "signer",
      "key": "candidate",
      "name": "Jane Doe",
      "email": "jane.doe@example.com"
    },
    {
      "type": "automatic_signer",
      "key": "agency",
      "name": "Acme Corp Authorized Signatory",
      "signature": {
        "type": "drawn",
        "url": "https://api.signatureapi.com/v1/uploads/upl_xxxxxxxxxxxxxxxxxxxxxx"
      },
      "mandate": "Authorized by Acme Corp board resolution 2026-04 (synthetic example)"
    }
  ]
}
```

## Run it

```bash
cd use-cases/staffing-onboarding
node index.mjs
# or: npm start
```

Optional: set `SIGNATUREAPI_BASE_URL` to point at another API host. The default is `https://api.signatureapi.com`.

## Expected output

```text
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient candidate: signer (re_1sAAaVfabdt0esVjmSTm0)
  recipient agency: automatic_signer (re_1sAAaVfabdt0esVjmSTm1)
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient candidate: signer (re_1sAAaVfabdt0esVjmSTm0)
  recipient agency: automatic_signer (re_1sAAaVfabdt0esVjmSTm1)
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient candidate: signer (re_1sAAaVfabdt0esVjmSTm0)
  recipient agency: automatic_signer (re_1sAAaVfabdt0esVjmSTm1)
```

This output was produced by running `node index.mjs` against a local mock of the API, so the ids are the fixed example ids. Against the real API you get a real envelope id and the status `processing`, which becomes `in_progress` once the envelope is sent. Test envelopes send no emails: open the Email view in the dashboard in test mode to see what recipients would receive.

## Run the tests

```bash
npm test
```

The offline tests check the payload and run the whole flow against a local mock HTTP server. The live test runs only when `SIGNATUREAPI_KEY` is set. It creates a test-mode envelope and asserts `201` and a UUID `id`. Without a key it is reported as skipped.

## Troubleshooting

- **`401 Unauthorized`.** The key is missing, mistyped or revoked. Check `SIGNATUREAPI_KEY`.
- **"This example runs in test mode only".** The key does not start with `key_test_`. Examples never run against live mode.
- **`422 Unprocessable Entity`.** The request body failed validation. The script prints the API error detail. Compare your change with the body above and the [create envelope reference](https://signatureapi.com/docs/api/resources/envelopes/create).
- **`422` missing preset symbol.** An automatic signer needs a `signature` image for every signature place assigned to it. Make sure the upload succeeded and you passed its `url`.
- **`429` too many requests.** Raise the delay between calls. See the rate limiting page.
- **The upload is rejected.** Uploads accept PDF, DOCX and PNG up to 4.5 MB, with a matching `Content-Type`.
- **Mandate wording.** The `mandate` is recorded in the audit log. Use the wording your legal team approves. The example text is synthetic.

## Learn more

- [Bulk-send placement agreements from a CSV and countersign automatically: the guide](https://signatureapi.com/docs/use-cases/staffing-onboarding)
- [Automatic signer](https://signatureapi.com/docs/api/resources/recipients/automatic-signer)
- [Create an upload](https://signatureapi.com/docs/api/resources/uploads/create)
- [Send bulk envelopes](https://signatureapi.com/docs/api/guides/use-cases/bulk-envelopes)
- [Rate limiting](https://signatureapi.com/docs/api/rate-limiting)
- [Envelope metadata](https://signatureapi.com/docs/api/resources/envelopes/metadata)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## Files

- `index.mjs`
- `index.test.mjs`
- `package.json`
- `candidates.csv`
