# Open accounts with a two-step signed agreement and automatic countersign (Node.js)

The customer authenticates twice and signs, and your institution countersigns automatically. Runs in test mode, needs no dependencies, and takes about a minute.

## The problem

Account opening needs the customer agreement signed and countersigned before funds can move. A manual countersignature step slows every new customer, and a signing link sent by plain email is weak for a financial document.

This envelope adds a second authentication step for the customer and applies your countersignature automatically.

## What you build

A small Node.js script (`index.mjs`) with two parts:

- `buildEnvelope()`: a pure function that returns the `POST /v1/envelopes` request body. No network, no clock, so it is easy to test.
- `send()` and `main()`: send it with the built-in `fetch` and print a summary.

API features shown: Automatic signer countersignature, two-step authentication, deliverable, checkboxes.

The envelope shape and why:

- **Two authentication methods.** `email_link` then `email_code`. The customer needs the link and a code from a separate email.
- **Automatic countersignature.** An `automatic_signer` with an uploaded signature image and a `mandate`.
- **Two required checkboxes.** Acceptance of the account terms and consent to electronic records, each stored with `capture_as`.
- **Standard deliverable.** Signed agreement plus audit log, which records the authentication methods.

## Prerequisites

- Node.js 20 or newer (uses the built-in `fetch` and `node:test`). No `npm install` needed.
- A SignatureAPI **test** API key. It starts with `key_test_`. Create one in the [dashboard](https://dashboard.signatureapi.com). The script refuses any other key.

## Step by step

1. **Set the key.** Export it. The script never prints it.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Upload the countersignature image.** `uploadMark()` returns the `url` to use in `signature`.
3. **Configure authentication.** `ceremony.authentication` on the customer lists both methods in order.
4. **Add the checkboxes and signatures.** Customer places plus the countersignature place owned by the automatic signer.
5. **Create and monitor.** The customer completes the ceremony. The envelope completes when they finish, because the countersignature is already applied.
6. **Send it.** `send()` calls `POST /v1/envelopes` with the `X-API-Key` header and returns the created envelope. A `201 Created` response carries the envelope `id` (a UUID) and its `recipients`.

The full request body this example sends (default values):

```json
{
  "title": "Account Agreement (sample)",
  "message": "Please accept the terms and sign your account agreement.",
  "routing": "sequential",
  "metadata": {
    "application_id": "app_8841"
  },
  "topics": [
    "fintech",
    "account_opening"
  ],
  "deliverable": {
    "type": "standard"
  },
  "documents": [
    {
      "key": "account_agreement",
      "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
      "format": "pdf",
      "fixed_positions": [
        {
          "place_key": "accept_terms",
          "page": 1,
          "top": 130,
          "left": 210
        },
        {
          "place_key": "accept_esign",
          "page": 1,
          "top": 150,
          "left": 210
        },
        {
          "place_key": "customer_signature",
          "page": 1,
          "top": 172,
          "left": 210
        },
        {
          "place_key": "institution_countersignature",
          "page": 1,
          "top": 186,
          "left": 220
        }
      ],
      "places": [
        {
          "key": "accept_terms",
          "type": "checkbox",
          "recipient_key": "customer",
          "requirement": "required",
          "capture_as": "accepted_terms"
        },
        {
          "key": "accept_esign",
          "type": "checkbox",
          "recipient_key": "customer",
          "requirement": "required",
          "capture_as": "accepted_esign"
        },
        {
          "key": "customer_signature",
          "type": "signature",
          "recipient_key": "customer"
        },
        {
          "key": "institution_countersignature",
          "type": "signature",
          "recipient_key": "institution"
        }
      ]
    }
  ],
  "recipients": [
    {
      "type": "signer",
      "key": "customer",
      "name": "Jane Doe",
      "email": "jane.doe@example.com",
      "ceremony": {
        "authentication": [
          {
            "type": "email_link"
          },
          {
            "type": "email_code"
          }
        ]
      }
    },
    {
      "type": "automatic_signer",
      "key": "institution",
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
cd use-cases/fintech-account-opening
node index.mjs
# or: npm start
```

Optional: set `SIGNATUREAPI_BASE_URL` to point at another API host. The default is `https://api.signatureapi.com`.

## Expected output

```text
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient customer: signer (re_1sAAaVfabdt0esVjmSTm0)
  recipient institution: automatic_signer (re_1sAAaVfabdt0esVjmSTm1)
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
- **Legal weight of automatic signing.** See the automatic signer page for the jurisdiction notes. Consult counsel before using it for regulated documents.
- **Customer cannot continue.** They need both emails. Resend the request if the code email is missing.

## Learn more

- [Open accounts with a two-step signed agreement and automatic countersign: the guide](https://signatureapi.com/docs/use-cases/fintech-account-opening)
- [Automatic signer](https://signatureapi.com/docs/api/resources/recipients/automatic-signer)
- [Multiple authentication methods](https://signatureapi.com/docs/api/resources/ceremonies/authentication/multiple)
- [Email link authentication](https://signatureapi.com/docs/api/resources/ceremonies/authentication/email-link)
- [Standard deliverable](https://signatureapi.com/docs/api/resources/deliverables/standard)
- [Checkbox place](https://signatureapi.com/docs/api/resources/places/checkbox)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## Files

- `index.mjs`
- `index.test.mjs`
- `package.json`
