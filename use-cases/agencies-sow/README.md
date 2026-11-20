# Send a statement of work and an NDA in one envelope (Node.js)

Bundle a SOW and an NDA, sign both once, and choose which files go into the deliverable. Runs in test mode, needs no dependencies, and takes about a minute.

## The problem

An agency starts a project with two documents: a statement of work and an NDA. Sending them separately doubles the emails and the chance that one stays unsigned.

One envelope can hold several documents. The client signs once and both documents are covered by one audit log.

## What you build

A small Node.js script (`index.mjs`) with two parts:

- `buildEnvelope()`: a pure function that returns the `POST /v1/envelopes` request body. No network, no clock, so it is easy to test.
- `send()` and `main()`: send it with the built-in `fetch` and print a summary.

API features shown: Several documents in one envelope, per-document places, deliverable options.

The envelope shape and why:

- **Two documents.** Each has its own `key` (`sow`, `nda`), its own `places` and its own `fixed_positions`. Place keys are unique across the envelope.
- **Sequential signers.** The agency lead signs first, then the client.
- **No sender block by default.** A `sender` block changes the name and email recipients see, but its email must first be an [authorized sender](https://signatureapi.com/docs/api/resources/senders/create) of your account. Otherwise the API returns `422`. Add it once your agency's sender is verified.
- **Deliverable.** `deliverable.included_documents` lists which document keys go into the signed package, and `deliverable.name` names it.

## Prerequisites

- Node.js 20 or newer (uses the built-in `fetch` and `node:test`). No `npm install` needed.
- A SignatureAPI **test** API key. It starts with `key_test_`. Create one in the [dashboard](https://dashboard.signatureapi.com). The script refuses any other key.

## Step by step

1. **Set the key.** Export it. The script never prints it.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Give each document a key.** Keys start with a lowercase letter and may use letters, digits and underscores. They are how the deliverable refers to documents.
3. **Add places per document.** Each document gets a signature place per signer. Place keys must be unique, so they carry the document name.
4. **Optional: set the sender.** After you [create and verify a sender](https://signatureapi.com/docs/api/resources/senders/create), add `sender: { name, email, organization }` so recipients see your agency.
5. **Choose the deliverable.** A `standard` deliverable includes the audit log. `included_documents` narrows the documents it contains.
6. **Send it.** `send()` calls `POST /v1/envelopes` with the `X-API-Key` header and returns the created envelope. A `201 Created` response carries the envelope `id` (a UUID) and its `recipients`.

The full request body this example sends (default values):

```json
{
  "title": "Statement of Work and Mutual NDA (sample)",
  "message": "Please sign both documents to start the project.",
  "routing": "sequential",
  "metadata": {
    "project_code": "prj_301",
    "sow_version": "v3"
  },
  "topics": [
    "agency",
    "sow"
  ],
  "deliverable": {
    "type": "standard",
    "name": "project_kickoff",
    "included_documents": [
      "sow",
      "nda"
    ]
  },
  "documents": [
    {
      "key": "sow",
      "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
      "format": "pdf",
      "fixed_positions": [
        {
          "place_key": "client_signs_sow",
          "page": 1,
          "top": 172,
          "left": 210
        },
        {
          "place_key": "agency_signs_sow",
          "page": 1,
          "top": 186,
          "left": 220
        }
      ],
      "places": [
        {
          "key": "client_signs_sow",
          "type": "signature",
          "recipient_key": "client"
        },
        {
          "key": "agency_signs_sow",
          "type": "signature",
          "recipient_key": "agency"
        }
      ]
    },
    {
      "key": "nda",
      "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
      "format": "pdf",
      "fixed_positions": [
        {
          "place_key": "client_signs_nda",
          "page": 1,
          "top": 172,
          "left": 210
        },
        {
          "place_key": "agency_signs_nda",
          "page": 1,
          "top": 186,
          "left": 220
        }
      ],
      "places": [
        {
          "key": "client_signs_nda",
          "type": "signature",
          "recipient_key": "client"
        },
        {
          "key": "agency_signs_nda",
          "type": "signature",
          "recipient_key": "agency"
        }
      ]
    }
  ],
  "recipients": [
    {
      "type": "signer",
      "key": "agency",
      "name": "John Smith",
      "email": "john.smith@example.com"
    },
    {
      "type": "signer",
      "key": "client",
      "name": "Jane Doe",
      "email": "jane.doe@example.com"
    }
  ]
}
```

## Run it

```bash
cd use-cases/agencies-sow
node index.mjs
# or: npm start
```

Optional: set `SIGNATUREAPI_BASE_URL` to point at another API host. The default is `https://api.signatureapi.com`.

## Expected output

```text
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient agency: signer (re_1sAAaVfabdt0esVjmSTm0)
  recipient client: signer (re_1sAAaVfabdt0esVjmSTm1)
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
- **`422` duplicate place key.** Two documents cannot reuse the same place key. Prefix with the document.
- **`422` unknown included document.** Every entry in `included_documents` must match a document `key`.

## Learn more

- [Send a statement of work and an NDA in one envelope: the guide](https://signatureapi.com/docs/use-cases/agencies-sow)
- [Envelope create reference](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Documents](https://signatureapi.com/docs/api/resources/documents/object)
- [Standard deliverable](https://signatureapi.com/docs/api/resources/deliverables/standard)
- [Sequential signing](https://signatureapi.com/docs/api/guides/how-to/sequential-signing)
- [Fixed positions](https://signatureapi.com/docs/api/guides/how-to/use-fixed-positions)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## Files

- `index.mjs`
- `index.test.mjs`
- `package.json`
