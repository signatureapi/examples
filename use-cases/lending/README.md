# Prepare a loan agreement, then collect borrower signatures (Node.js)

A loan officer fills in the amount, then the borrower and co-borrower sign in order. Runs in test mode, needs no dependencies, and takes about a minute.

## The problem

A loan agreement has terms a human decides at the last minute: the final amount, the rate, a date. The loan officer needs to fill them in before the borrower sees the document, and the borrower must not be able to edit them.

A preparer recipient fills in fields first. The envelope then moves on to the borrower and the co-borrower.

## What you build

A small Node.js script (`index.mjs`) with two parts:

- `buildEnvelope()`: a pure function that returns the `POST /v1/envelopes` request body. No network, no clock, so it is easy to test.
- `send()` and `main()`: send it with the built-in `fetch` and print a summary.

API features shown: Preparer, sequential routing, text input with capture, checkbox, two signers.

The envelope shape and why:

- **Preparer first.** `type: "preparer"` can fill text inputs, checkboxes and dropdowns but cannot sign. The loan officer enters the amount in a `text_input` place.
- **`capture_as`.** The amount is stored in the envelope `captures` under `loan_amount`, so your system can read it back after completion.
- **Two signers in sequence.** Borrower, then co-borrower. The borrower also ticks a required disclosure checkbox.
- **Metadata.** `metadata.loan_ref` is an opaque reference to your loan record.

## Prerequisites

- Node.js 20 or newer (uses the built-in `fetch` and `node:test`). No `npm install` needed.
- A SignatureAPI **test** API key. It starts with `key_test_`. Create one in the [dashboard](https://dashboard.signatureapi.com). The script refuses any other key.

## Step by step

1. **Set the key.** Export it. The script never prints it.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Put the preparer first.** The preparer must come before the signers in `recipients`. Preparers default to `delivery_type: "none"`, so they do not receive the final deliverable by email.
3. **Add the preparer place.** A `text_input` with `recipient_key: "loan_officer"`, a `width`, and `capture_as: "loan_amount"`.
4. **Add the borrower places.** A signature, plus a `checkbox` with `requirement: "required"` and `capture_as`.
5. **Add the co-borrower signature.** One more signature place for the second signer.
6. **Read the captures.** After completion, fetch the envelope and read `captures.loan_amount`.
7. **Send it.** `send()` calls `POST /v1/envelopes` with the `X-API-Key` header and returns the created envelope. A `201 Created` response carries the envelope `id` (a UUID) and its `recipients`.

The full request body this example sends (default values):

```json
{
  "title": "Personal Loan Agreement (sample)",
  "message": "Please review the loan terms and sign.",
  "routing": "sequential",
  "metadata": {
    "loan_ref": "loan_5120"
  },
  "topics": [
    "lending",
    "loan_agreements"
  ],
  "documents": [
    {
      "key": "loan_agreement",
      "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
      "format": "pdf",
      "fixed_positions": [
        {
          "place_key": "loan_amount",
          "page": 1,
          "top": 140,
          "left": 210
        },
        {
          "place_key": "disclosures_ack",
          "page": 1,
          "top": 230,
          "left": 210
        },
        {
          "place_key": "borrower_signature",
          "page": 1,
          "top": 172,
          "left": 210
        },
        {
          "place_key": "coborrower_signature",
          "page": 1,
          "top": 186,
          "left": 220
        }
      ],
      "places": [
        {
          "key": "loan_amount",
          "type": "text_input",
          "recipient_key": "loan_officer",
          "prompt": "Loan amount",
          "width": 160,
          "capture_as": "loan_amount"
        },
        {
          "key": "disclosures_ack",
          "type": "checkbox",
          "recipient_key": "borrower",
          "requirement": "required",
          "capture_as": "disclosures_ack"
        },
        {
          "key": "borrower_signature",
          "type": "signature",
          "recipient_key": "borrower"
        },
        {
          "key": "coborrower_signature",
          "type": "signature",
          "recipient_key": "coborrower"
        }
      ]
    }
  ],
  "recipients": [
    {
      "type": "preparer",
      "key": "loan_officer",
      "name": "Sam Patel",
      "email": "sam.patel@example.com"
    },
    {
      "type": "signer",
      "key": "borrower",
      "name": "Jane Doe",
      "email": "jane.doe@example.com"
    },
    {
      "type": "signer",
      "key": "coborrower",
      "name": "John Smith",
      "email": "john.smith@example.com"
    }
  ]
}
```

## Run it

```bash
cd use-cases/lending
node index.mjs
# or: npm start
```

Optional: set `SIGNATUREAPI_BASE_URL` to point at another API host. The default is `https://api.signatureapi.com`.

## Expected output

```text
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient loan_officer: preparer (re_1sAAaVfabdt0esVjmSTm0)
  recipient borrower: signer (re_1sAAaVfabdt0esVjmSTm1)
  recipient coborrower: signer (re_1sAAaVfabdt0esVjmSTm2)
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
- **Borrower sees an empty amount.** The preparer has not clicked Finish yet. The envelope only moves on after they do.
- **`422` on a preparer signature place.** Preparers cannot sign. Assign signature and initials places to signers only.
- **`capture_as` rejected.** It must start with a lowercase letter and use lowercase letters, digits and underscores, up to 32 characters.

## Learn more

- [Prepare a loan agreement, then collect borrower signatures: the guide](https://signatureapi.com/docs/use-cases/lending)
- [Prepare before signing](https://signatureapi.com/docs/api/guides/how-to/prepare-before-signing)
- [Preparer recipient](https://signatureapi.com/docs/api/resources/recipients/preparer)
- [Text input place](https://signatureapi.com/docs/api/resources/places/text-input)
- [Checkbox place](https://signatureapi.com/docs/api/resources/places/checkbox)
- [Envelope captures](https://signatureapi.com/docs/api/resources/envelopes/captures)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## Files

- `index.mjs`
- `index.test.mjs`
- `package.json`
