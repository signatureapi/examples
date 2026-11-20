# Send a vehicle purchase agreement with auto-filled fields (Node.js)

Fill the buyer name, email and signing dates automatically while the buyer only initials and signs. Runs in test mode, needs no dependencies, and takes about a minute.

## The problem

A dealership deal has many small places: initials on each disclosure, the buyer name printed under the signature, the date next to it. Typing those by hand is where mistakes happen.

Some places fill themselves. A name place prints the recipient name, an email place prints the email and a date place stamps the signing moment.

## What you build

A small Node.js script (`index.mjs`) with two parts:

- `buildEnvelope()`: a pure function that returns the `POST /v1/envelopes` request body. No network, no clock, so it is easy to test.
- `send()` and `main()`: send it with the built-in `fetch` and print a summary.

API features shown: Sequential routing, initials, auto-filled name, email and date places.

The envelope shape and why:

- **Auto-filled places.** `recipient_name`, `recipient_email` and `recipient_completed_date` need no input from the signer.
- **Initials.** Two `initials` places for the odometer and financing disclosures.
- **Sequential routing.** The buyer signs, then the dealership representative.
- **Envelope date.** `envelope_completed_date` stamps the moment the whole envelope completes.

## Prerequisites

- Node.js 20 or newer (uses the built-in `fetch` and `node:test`). No `npm install` needed.
- A SignatureAPI **test** API key. It starts with `key_test_`. Create one in the [dashboard](https://dashboard.signatureapi.com). The script refuses any other key.

## Step by step

1. **Set the key.** Export it. The script never prints it.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Add the auto-filled places.** They only need a `key`, a `type` and, for most, a `recipient_key`.
3. **Add initials.** Each initials place has a unique `key`. Set `height` between 20 and 60.
4. **Add the signatures.** Buyer first, dealership second.
5. **Add the envelope date.** `envelope_completed_date` takes no `recipient_key`.
6. **Send it.** `send()` calls `POST /v1/envelopes` with the `X-API-Key` header and returns the created envelope. A `201 Created` response carries the envelope `id` (a UUID) and its `recipients`.

The full request body this example sends (default values):

```json
{
  "title": "Vehicle Purchase Agreement (sample)",
  "message": "Please review the agreement, initial the disclosures and sign.",
  "routing": "sequential",
  "metadata": {
    "deal_id": "deal_5150"
  },
  "topics": [
    "automotive",
    "purchase"
  ],
  "documents": [
    {
      "key": "purchase_agreement",
      "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
      "format": "pdf",
      "fixed_positions": [
        {
          "place_key": "odometer_initials",
          "page": 1,
          "top": 250,
          "left": 72
        },
        {
          "place_key": "financing_initials",
          "page": 1,
          "top": 250,
          "left": 140
        },
        {
          "place_key": "buyer_signature",
          "page": 1,
          "top": 172,
          "left": 210
        },
        {
          "place_key": "buyer_name",
          "page": 1,
          "top": 200,
          "left": 210
        },
        {
          "place_key": "buyer_email",
          "page": 1,
          "top": 214,
          "left": 210
        },
        {
          "place_key": "buyer_signed_on",
          "page": 1,
          "top": 172,
          "left": 420
        },
        {
          "place_key": "dealer_signature",
          "page": 1,
          "top": 186,
          "left": 220
        },
        {
          "place_key": "completed_on",
          "page": 1,
          "top": 186,
          "left": 430
        }
      ],
      "places": [
        {
          "key": "odometer_initials",
          "type": "initials",
          "recipient_key": "buyer",
          "height": 30
        },
        {
          "key": "financing_initials",
          "type": "initials",
          "recipient_key": "buyer",
          "height": 30
        },
        {
          "key": "buyer_signature",
          "type": "signature",
          "recipient_key": "buyer"
        },
        {
          "key": "buyer_name",
          "type": "recipient_name",
          "recipient_key": "buyer"
        },
        {
          "key": "buyer_email",
          "type": "recipient_email",
          "recipient_key": "buyer"
        },
        {
          "key": "buyer_signed_on",
          "type": "recipient_completed_date",
          "recipient_key": "buyer",
          "date_format": "MMM D, YYYY"
        },
        {
          "key": "dealer_signature",
          "type": "signature",
          "recipient_key": "dealer"
        },
        {
          "key": "completed_on",
          "type": "envelope_completed_date",
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
      "key": "dealer",
      "name": "John Smith",
      "email": "john.smith@example.com"
    }
  ]
}
```

## Run it

```bash
cd use-cases/automotive
node index.mjs
# or: npm start
```

Optional: set `SIGNATUREAPI_BASE_URL` to point at another API host. The default is `https://api.signatureapi.com`.

## Expected output

```text
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient buyer: signer (re_1sAAaVfabdt0esVjmSTm0)
  recipient dealer: signer (re_1sAAaVfabdt0esVjmSTm1)
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
- **`422` on `envelope_completed_date`.** It does not accept `recipient_key`. Remove it.
- **Date format looks wrong.** Set `date_format`, for example `MMM D, YYYY`.

## Learn more

- [Send a vehicle purchase agreement with auto-filled fields: the guide](https://signatureapi.com/docs/use-cases/automotive)
- [Date places](https://signatureapi.com/docs/api/resources/places/date)
- [Recipient name place](https://signatureapi.com/docs/api/resources/places/recipient-name)
- [Recipient email place](https://signatureapi.com/docs/api/resources/places/recipient-email)
- [Initials place](https://signatureapi.com/docs/api/resources/places/initials)
- [Places overview](https://signatureapi.com/docs/api/resources/places/object)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## Files

- `index.mjs`
- `index.test.mjs`
- `package.json`
