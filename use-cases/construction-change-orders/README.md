# Route construction change orders for approval and signature (Node.js)

An owner representative approves, the contractor describes the change, and the owner signs. Runs in test mode, needs no dependencies, and takes about a minute.

## The problem

A change order alters the price or schedule of a project, so it needs a clear approval chain. On a job site the chain is usually phone calls and photos of paper.

This envelope puts the chain in order: the owner representative approves the request, the contractor adds a scope note and signs, and the owner signs last.

## What you build

A small Node.js script (`index.mjs`) with two parts:

- `buildEnvelope()`: a pure function that returns the `POST /v1/envelopes` request body. No network, no clock, so it is easy to test.
- `send()` and `main()`: send it with the built-in `fetch` and print a summary.

API features shown: Approver, two signers in sequence, prefilled text place, multiline text input.

The envelope shape and why:

- **Approver, then two signers.** Sequential routing: `owner_rep` (approver), `contractor`, `owner`.
- **Prefilled text.** A `text` place prints the change order number (`Change Order CO-014`) on the document. The value comes from your system.
- **Multiline input.** The contractor writes a scope note in a `multiline_text_input` place with a `line_count`.
- **Metadata.** `project_id` and `change_order` correlate the envelope with your project system.

## Prerequisites

- Node.js 20 or newer (uses the built-in `fetch` and `node:test`). No `npm install` needed.
- A SignatureAPI **test** API key. It starts with `key_test_`. Create one in the [dashboard](https://dashboard.signatureapi.com). The script refuses any other key.

## Step by step

1. **Set the key.** Export it. The script never prints it.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Order the recipients.** Approver, contractor, owner. A later recipient waits in `awaiting`.
3. **Print the number with a text place.** `type: "text"` has a fixed `value` and no `recipient_key`.
4. **Add the scope note.** `multiline_text_input` needs `width` and `line_count`. `capture_as` stores the text.
5. **Add both signatures.** Contractor and owner each get a signature place.
6. **Send it.** `send()` calls `POST /v1/envelopes` with the `X-API-Key` header and returns the created envelope. A `201 Created` response carries the envelope `id` (a UUID) and its `recipients`.

The full request body this example sends (default values):

```json
{
  "title": "Change Order CO-014 (sample)",
  "message": "Please review the change order and sign.",
  "routing": "sequential",
  "metadata": {
    "project_id": "proj_88",
    "change_order": "CO-014"
  },
  "topics": [
    "construction",
    "change_orders"
  ],
  "documents": [
    {
      "key": "change_order",
      "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
      "format": "pdf",
      "fixed_positions": [
        {
          "place_key": "co_number",
          "page": 1,
          "top": 100,
          "left": 210
        },
        {
          "place_key": "scope_note",
          "page": 1,
          "top": 125,
          "left": 210
        },
        {
          "place_key": "contractor_signature",
          "page": 1,
          "top": 172,
          "left": 210
        },
        {
          "place_key": "owner_signature",
          "page": 1,
          "top": 186,
          "left": 220
        }
      ],
      "places": [
        {
          "key": "co_number",
          "type": "text",
          "value": "Change Order CO-014"
        },
        {
          "key": "scope_note",
          "type": "multiline_text_input",
          "recipient_key": "contractor",
          "prompt": "Scope of change",
          "width": 300,
          "line_count": 3,
          "capture_as": "scope_note"
        },
        {
          "key": "contractor_signature",
          "type": "signature",
          "recipient_key": "contractor"
        },
        {
          "key": "owner_signature",
          "type": "signature",
          "recipient_key": "owner"
        }
      ]
    }
  ],
  "recipients": [
    {
      "type": "approver",
      "key": "owner_rep",
      "name": "Alex Chen",
      "email": "alex.chen@example.com"
    },
    {
      "type": "signer",
      "key": "contractor",
      "name": "John Smith",
      "email": "john.smith@example.com"
    },
    {
      "type": "signer",
      "key": "owner",
      "name": "Jane Doe",
      "email": "jane.doe@example.com"
    }
  ]
}
```

## Run it

```bash
cd use-cases/construction-change-orders
node index.mjs
# or: npm start
```

Optional: set `SIGNATUREAPI_BASE_URL` to point at another API host. The default is `https://api.signatureapi.com`.

## Expected output

```text
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient owner_rep: approver (re_1sAAaVfabdt0esVjmSTm0)
  recipient contractor: signer (re_1sAAaVfabdt0esVjmSTm1)
  recipient owner: signer (re_1sAAaVfabdt0esVjmSTm2)
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
- **`422` on the text place.** A `text` place has no `recipient_key`. It needs `value` (1 to 1000 characters).
- **Note text is cut off.** Increase `line_count` or reduce `font_size`.

## Learn more

- [Route construction change orders for approval and signature: the guide](https://signatureapi.com/docs/use-cases/construction-change-orders)
- [Text place](https://signatureapi.com/docs/api/resources/places/text)
- [Multiline text input](https://signatureapi.com/docs/api/resources/places/multiline-text-input)
- [Approver recipient](https://signatureapi.com/docs/api/resources/recipients/approver)
- [Sequential signing](https://signatureapi.com/docs/api/guides/how-to/sequential-signing)
- [Envelope metadata](https://signatureapi.com/docs/api/resources/envelopes/metadata)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## Files

- `index.mjs`
- `index.test.mjs`
- `package.json`
