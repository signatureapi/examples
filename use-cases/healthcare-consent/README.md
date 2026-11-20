# Collect a treatment consent signature with two-step authentication (Node.js)

Send a consent form that needs an email link and a separate email code, with no health data in the payload. Runs in test mode, needs no dependencies, and takes about a minute.

## The problem

Clinics need a signed consent before an appointment. The document is sensitive, and a signing link sent by plain email can be forwarded or intercepted.

SignatureAPI can require a second step. The signer gets the link by email and must also enter a code that arrives in a separate email.

## What you build

A small Node.js script (`index.mjs`) with two parts:

- `buildEnvelope()`: a pure function that returns the `POST /v1/envelopes` request body. No network, no clock, so it is easy to test.
- `send()` and `main()`: send it with the built-in `fetch` and print a summary.

API features shown: Email link plus email code authentication, required checkbox with capture, opaque metadata.

The envelope shape and why:

- **Two authentication methods.** `ceremony.authentication` lists `email_link` then `email_code`. The signer completes them in sequence. The HIPAA compliance page describes this pattern for links sent over unencrypted channels.
- **No health data in the request.** The envelope carries an opaque `visit_ref` in `metadata`, never diagnoses, record numbers or free text about the patient. Keep patient details in your own system and join on the reference.
- **One required checkbox.** The patient confirms consent. `capture_as` stores the answer in the envelope `captures`.
- **Signature place.** The patient signs the sample document, a stand-in for your own consent form.

## Prerequisites

- Node.js 20 or newer (uses the built-in `fetch` and `node:test`). No `npm install` needed.
- A SignatureAPI **test** API key. It starts with `key_test_`. Create one in the [dashboard](https://dashboard.signatureapi.com). The script refuses any other key.

## Step by step

1. **Set the key.** Export it. The script never prints it.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Configure the ceremony.** Add `ceremony.authentication` to the signer with `email_link` first and `email_code` second.
3. **Keep the payload free of health data.** Use opaque references only. This example sends `visit_ref: "visit_5521"`.
4. **Add the consent checkbox.** `requirement: "required"` blocks the signer from finishing until the box is ticked.
5. **Send it.** In test mode no email goes out. The dashboard Email view shows the link email and the code email.
6. **Send it.** `send()` calls `POST /v1/envelopes` with the `X-API-Key` header and returns the created envelope. A `201 Created` response carries the envelope `id` (a UUID) and its `recipients`.

The full request body this example sends (default values):

```json
{
  "title": "Treatment Consent (sample)",
  "message": "Please review and sign the consent form. You will also need the code we email you separately.",
  "metadata": {
    "visit_ref": "visit_5521"
  },
  "topics": [
    "healthcare",
    "consent"
  ],
  "documents": [
    {
      "key": "consent_form",
      "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
      "format": "pdf",
      "fixed_positions": [
        {
          "place_key": "consent_given",
          "page": 1,
          "top": 140,
          "left": 210
        },
        {
          "place_key": "patient_signature",
          "page": 1,
          "top": 172,
          "left": 210
        }
      ],
      "places": [
        {
          "key": "consent_given",
          "type": "checkbox",
          "recipient_key": "patient",
          "requirement": "required",
          "capture_as": "consent_given"
        },
        {
          "key": "patient_signature",
          "type": "signature",
          "recipient_key": "patient"
        }
      ]
    }
  ],
  "recipients": [
    {
      "type": "signer",
      "key": "patient",
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
    }
  ]
}
```

## Run it

```bash
cd use-cases/healthcare-consent
node index.mjs
# or: npm start
```

Optional: set `SIGNATUREAPI_BASE_URL` to point at another API host. The default is `https://api.signatureapi.com`.

## Expected output

```text
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient patient: signer (re_1sAAaVfabdt0esVjmSTm0)
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
- **The signer says the code never arrived.** Codes go to the recipient email on the envelope. Check the address and spam, and use the resend endpoint.
- **`422` on the ceremony.** The `authentication` array allows between 1 and 5 entries, each with a known `type`.

## Learn more

- [Collect a treatment consent signature with two-step authentication: the guide](https://signatureapi.com/docs/use-cases/healthcare-consent)
- [HIPAA at SignatureAPI](https://signatureapi.com/docs/trust/compliance/hipaa)
- [Multiple authentication methods](https://signatureapi.com/docs/api/resources/ceremonies/authentication/multiple)
- [Email code authentication](https://signatureapi.com/docs/api/resources/ceremonies/authentication/email-code)
- [Checkbox place](https://signatureapi.com/docs/api/resources/places/checkbox)
- [Resend a request](https://signatureapi.com/docs/api/resources/recipients/resend)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## Files

- `index.mjs`
- `index.test.mjs`
- `package.json`
