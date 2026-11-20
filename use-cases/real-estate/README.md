# Send a purchase agreement to buyer and seller in order (Node.js)

Collect buyer and seller signatures in a fixed order with automatic signing dates. Runs in test mode, needs no dependencies, and takes about a minute.

## The problem

A purchase agreement has to be signed by the buyer before the seller counters. If both get the document at once, the seller can sign a version the buyer has not accepted yet. Agents end up relaying PDFs by hand to keep the order.

Sequential routing makes the order part of the envelope. The seller is only invited after the buyer has finished.

## What you build

A small Node.js script (`index.mjs`) with two parts:

- `buildEnvelope()`: a pure function that returns the `POST /v1/envelopes` request body. No network, no clock, so it is easy to test.
- `send()` and `main()`: send it with the built-in `fetch` and print a summary.

API features shown: Sequential routing with two signers, signing dates, metadata, topics.

The envelope shape and why:

- **Sequential routing.** `routing: "sequential"` is the default. The order of the `recipients` array is the signing order: buyer, then seller.
- **Two signature places, two date places.** Each signer gets a `signature` place and a `recipient_completed_date` place that SignatureAPI fills with the moment that recipient finishes.
- **Fixed positions.** The sample PDF has no `[[placeholders]]`, so each place is anchored with `fixed_positions`.
- **Correlation.** `metadata.transaction_id` ties the envelope to your transaction record. `topics` tag it for webhook filtering.

## Prerequisites

- Node.js 20 or newer (uses the built-in `fetch` and `node:test`). No `npm install` needed.
- A SignatureAPI **test** API key. It starts with `key_test_`. Create one in the [dashboard](https://dashboard.signatureapi.com). The script refuses any other key.

## Step by step

1. **Set the key.** Export it. The script never prints it.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **List the recipients in signing order.** Buyer `buyer` first, seller `seller` second. A later recipient waits in `awaiting` status until the earlier one completes.
3. **Place the signatures.** Each signature place references its signer with `recipient_key`. The buyer signs the client line, the seller signs the provider line.
4. **Add the dates.** `recipient_completed_date` places are stamped when the recipient signs. Use `date_format` to change the layout.
5. **Tag the envelope.** `metadata.transaction_id` and `topics` make the envelope easy to find from your CRM and from webhook events.
6. **Send it.** `send()` calls `POST /v1/envelopes` with the `X-API-Key` header and returns the created envelope. A `201 Created` response carries the envelope `id` (a UUID) and its `recipients`.

The full request body this example sends (default values):

```json
{
  "title": "Residential Purchase Agreement (sample)",
  "message": "Please review and sign the purchase agreement.",
  "routing": "sequential",
  "metadata": {
    "transaction_id": "txn_7731",
    "property_ref": "lot_12"
  },
  "topics": [
    "real_estate",
    "purchase"
  ],
  "documents": [
    {
      "key": "purchase_agreement",
      "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
      "format": "pdf",
      "fixed_positions": [
        {
          "place_key": "buyer_signature",
          "page": 1,
          "top": 172,
          "left": 210
        },
        {
          "place_key": "buyer_date",
          "page": 1,
          "top": 172,
          "left": 420
        },
        {
          "place_key": "seller_signature",
          "page": 1,
          "top": 186,
          "left": 220
        },
        {
          "place_key": "seller_date",
          "page": 1,
          "top": 186,
          "left": 430
        }
      ],
      "places": [
        {
          "key": "buyer_signature",
          "type": "signature",
          "recipient_key": "buyer"
        },
        {
          "key": "buyer_date",
          "type": "recipient_completed_date",
          "recipient_key": "buyer",
          "date_format": "MMM D, YYYY"
        },
        {
          "key": "seller_signature",
          "type": "signature",
          "recipient_key": "seller"
        },
        {
          "key": "seller_date",
          "type": "recipient_completed_date",
          "recipient_key": "seller",
          "date_format": "MMM D, YYYY"
        }
      ]
    }
  ],
  "recipients": [
    {
      "type": "signer",
      "key": "buyer",
      "name": "Jane Doe",
      "email": "jane.doe@example.com"
    },
    {
      "type": "signer",
      "key": "seller",
      "name": "John Smith",
      "email": "john.smith@example.com"
    }
  ]
}
```

## Run it

```bash
cd use-cases/real-estate
node index.mjs
# or: npm start
```

Optional: set `SIGNATUREAPI_BASE_URL` to point at another API host. The default is `https://api.signatureapi.com`.

## Expected output

```text
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient buyer: signer (re_1sAAaVfabdt0esVjmSTm0)
  recipient seller: signer (re_1sAAaVfabdt0esVjmSTm1)
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
- **Both signers received the request at once.** Check that `routing` is `sequential` (or omitted) and not `parallel`.
- **`422` unknown recipient key.** Every `recipient_key` in a place must match a recipient `key` in the same envelope.
- **Seller is stuck in `awaiting`.** That is expected until the buyer completes. Watch the `recipient.completed` event.

## Learn more

- [Send a purchase agreement to buyer and seller in order: the guide](https://signatureapi.com/docs/use-cases/real-estate)
- [Sequential signing](https://signatureapi.com/docs/api/guides/how-to/sequential-signing)
- [Routing](https://signatureapi.com/docs/api/resources/envelopes/routing)
- [Date places](https://signatureapi.com/docs/api/resources/places/date)
- [Signature place](https://signatureapi.com/docs/api/resources/places/signature)
- [Webhooks](https://signatureapi.com/docs/api/webhooks)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## Files

- `index.mjs`
- `index.test.mjs`
- `package.json`
