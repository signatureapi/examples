# Send engagement letters with partner approval first (Node.js)

A partner approves the letter, then the client initials and signs it. Runs in test mode, needs no dependencies, and takes about a minute.

## The problem

A law firm does not want an engagement letter reaching a client before a partner has checked it. Email approval threads are hard to prove later.

An approver recipient reviews the document first and clicks Approve. Only then does the client receive it. The approval is part of the audit log.

## What you build

A small Node.js script (`index.mjs`) with two parts:

- `buildEnvelope()`: a pure function that returns the `POST /v1/envelopes` request body. No network, no clock, so it is easy to test.
- `send()` and `main()`: send it with the built-in `fetch` and print a summary.

API features shown: Approver then signer, initials, named deliverable, metadata, topics.

The envelope shape and why:

- **Approver first.** `type: "approver"`, no places assigned. Approvers can approve or reject.
- **Client second.** The client initials the fee clause and signs.
- **Named deliverable.** `deliverable.name` labels the signed package so you can find it in your matter system.
- **Metadata.** `matter_id` links the envelope to the matter.

## Prerequisites

- Node.js 20 or newer (uses the built-in `fetch` and `node:test`). No `npm install` needed.
- A SignatureAPI **test** API key. It starts with `key_test_`. Create one in the [dashboard](https://dashboard.signatureapi.com). The script refuses any other key.

## Step by step

1. **Set the key.** Export it. The script never prints it.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Add the approver before the signer.** Array order is routing order. The approver step finishes with Approve or Reject.
3. **Place the client initials and signature.** Only the signer owns places.
4. **Name the deliverable.** A `standard` deliverable includes the audit log, which records the approval.
5. **Handle rejection.** If the approver rejects, the recipient moves to `rejected` and you receive a `recipient.rejected` event.
6. **Send it.** `send()` calls `POST /v1/envelopes` with the `X-API-Key` header and returns the created envelope. A `201 Created` response carries the envelope `id` (a UUID) and its `recipients`.

The full request body this example sends (default values):

```json
{
  "title": "Engagement Letter (sample)",
  "message": "Please review the engagement letter, initial the fee clause and sign.",
  "routing": "sequential",
  "metadata": {
    "matter_id": "mat_2209"
  },
  "topics": [
    "legal",
    "engagement"
  ],
  "deliverable": {
    "type": "standard",
    "name": "engagement_letter_signed"
  },
  "documents": [
    {
      "key": "engagement_letter",
      "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
      "format": "pdf",
      "fixed_positions": [
        {
          "place_key": "fee_clause_initials",
          "page": 1,
          "top": 250,
          "left": 72
        },
        {
          "place_key": "client_signature",
          "page": 1,
          "top": 172,
          "left": 210
        }
      ],
      "places": [
        {
          "key": "fee_clause_initials",
          "type": "initials",
          "recipient_key": "client",
          "height": 30
        },
        {
          "key": "client_signature",
          "type": "signature",
          "recipient_key": "client"
        }
      ]
    }
  ],
  "recipients": [
    {
      "type": "approver",
      "key": "partner",
      "name": "Alex Chen",
      "email": "alex.chen@example.com"
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
cd use-cases/law-firm-engagement
node index.mjs
# or: npm start
```

Optional: set `SIGNATUREAPI_BASE_URL` to point at another API host. The default is `https://api.signatureapi.com`.

## Expected output

```text
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient partner: approver (re_1sAAaVfabdt0esVjmSTm0)
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
- **Client got the email before the partner approved.** Routing is `parallel`. Use `sequential`.
- **Approver gets no final copy.** Approvers default to `delivery_type: "none"`. Set it to `email` if they should receive the deliverable.

## Learn more

- [Send engagement letters with partner approval first: the guide](https://signatureapi.com/docs/use-cases/law-firm-engagement)
- [Send to an approver](https://signatureapi.com/docs/api/guides/how-to/send-to-approver)
- [Approver recipient](https://signatureapi.com/docs/api/resources/recipients/approver)
- [Standard deliverable](https://signatureapi.com/docs/api/resources/deliverables/standard)
- [Recipient events](https://signatureapi.com/docs/api/resources/events/recipient-events)
- [Initials place](https://signatureapi.com/docs/api/resources/places/initials)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## Files

- `index.mjs`
- `index.test.mjs`
- `package.json`
