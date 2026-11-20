# Send permit applications for signature and official approval (Node.js)

An applicant signs a permit form with a validated reference number, then an official approves it. Runs in test mode, needs no dependencies, and takes about a minute.

## The problem

A permit application has a reference format that must be right, a signature from the applicant, and a sign-off from an official. Counter visits and scanned PDFs make all three slow.

This envelope validates the reference number while the applicant types it, collects the signature, and then asks the official to approve.

## What you build

A small Node.js script (`index.mjs`) with two parts:

- `buildEnvelope()`: a pure function that returns the `POST /v1/envelopes` request body. No network, no clock, so it is easy to test.
- `send()` and `main()`: send it with the built-in `fetch` and print a summary.

API features shown: Standard signer plus official approver, regex-validated input, qualified signature path explained.

The envelope shape and why:

- **Validated text input.** `permit_ref` uses `format: "/^[A-Z]{2}-[0-9]{6}$/"` and a `format_message` shown when the value does not match.
- **Signer then approver.** The applicant signs, then the official approves. Approvers have no signature place.
- **Metadata and topics.** `permit_id` and topics tie the envelope to your case system.
- **This is a standard (simple) signature.** See the section below if your procedure needs a qualified electronic signature.

## Prerequisites

- Node.js 20 or newer (uses the built-in `fetch` and `node:test`). No `npm install` needed.
- A SignatureAPI **test** API key. It starts with `key_test_`. Create one in the [dashboard](https://dashboard.signatureapi.com). The script refuses any other key.

## Step by step

1. **Set the key.** Export it. The script never prints it.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Add the validated input.** A `text_input` place with a slash-delimited regular expression in `format`.
3. **Order the recipients.** Applicant `applicant` first, official `official` second.
4. **Send and monitor.** The official is invited after the applicant completes.
5. **Send it.** `send()` calls `POST /v1/envelopes` with the `X-API-Key` header and returns the created envelope. A `201 Created` response carries the envelope `id` (a UUID) and its `recipients`.

The full request body this example sends (default values):

```json
{
  "title": "Permit Application (sample)",
  "message": "Please enter your permit reference and sign the application.",
  "routing": "sequential",
  "metadata": {
    "permit_id": "permit_4410"
  },
  "topics": [
    "public_sector",
    "permits"
  ],
  "documents": [
    {
      "key": "permit_application",
      "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
      "format": "pdf",
      "fixed_positions": [
        {
          "place_key": "permit_ref",
          "page": 1,
          "top": 140,
          "left": 210
        },
        {
          "place_key": "applicant_signature",
          "page": 1,
          "top": 172,
          "left": 210
        }
      ],
      "places": [
        {
          "key": "permit_ref",
          "type": "text_input",
          "recipient_key": "applicant",
          "prompt": "Permit reference",
          "hint": "Format: AB-123456",
          "format": "/^[A-Z]{2}-[0-9]{6}$/",
          "format_message": "Use two capital letters, a dash and six digits",
          "width": 160,
          "capture_as": "permit_ref"
        },
        {
          "key": "applicant_signature",
          "type": "signature",
          "recipient_key": "applicant"
        }
      ]
    }
  ],
  "recipients": [
    {
      "type": "signer",
      "key": "applicant",
      "name": "Jane Doe",
      "email": "jane.doe@example.com"
    },
    {
      "type": "approver",
      "key": "official",
      "name": "Alex Chen",
      "email": "alex.chen@example.com"
    }
  ]
}
```

## Run it

```bash
cd use-cases/public-sector
node index.mjs
# or: npm start
```

Optional: set `SIGNATUREAPI_BASE_URL` to point at another API host. The default is `https://api.signatureapi.com`.

## Expected output

```text
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient applicant: signer (re_1sAAaVfabdt0esVjmSTm0)
  recipient official: approver (re_1sAAaVfabdt0esVjmSTm1)
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
- **`422` on `format`.** A custom format must start and end with a slash and be at most 100 characters.
- **The applicant cannot get past the field.** The value does not match the expression. Show them the `format_message`.

## If your procedure needs a qualified electronic signature

A regular signer produces a simple electronic signature. Some public procedures require a qualified electronic signature (QES) instead. SignatureAPI supports this with a `qualified_signer` recipient and `scheme: "eu_eidas"`.

Qualified signatures are in private beta. They are turned on per account, and until then an envelope with a qualified signer fails with the `qualified-signature-not-enabled` error, in test and live mode. This example does not include one for that reason. Read these pages, then [request access](https://signatureapi.com/docs/qualified-signatures#request-access):

- [What are qualified signatures?](https://signatureapi.com/docs/qualified-signatures)
- [How it works](https://signatureapi.com/docs/qualified-signatures/how-it-works)
- [Quickstart](https://signatureapi.com/docs/qualified-signatures/quickstart)
- [Envelope rules](https://signatureapi.com/docs/qualified-signatures/envelope-rules)

Country-specific standards such as NOM-151 (Mexico) or ICP-Brasil (Brazil) are not qualified signatures. They are [attestations](https://signatureapi.com/docs/api/resources/envelopes/attestation) and a different feature.

## Learn more

- [Send permit applications for signature and official approval: the guide](https://signatureapi.com/docs/use-cases/public-sector)
- [Qualified signatures overview](https://signatureapi.com/docs/qualified-signatures)
- [Qualified signer recipient](https://signatureapi.com/docs/api/resources/recipients/qualified-signer)
- [Qualified signatures quickstart](https://signatureapi.com/docs/qualified-signatures/quickstart)
- [Attestation](https://signatureapi.com/docs/api/resources/envelopes/attestation)
- [Text input place](https://signatureapi.com/docs/api/resources/places/text-input)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## Files

- `index.mjs`
- `index.test.mjs`
- `package.json`
