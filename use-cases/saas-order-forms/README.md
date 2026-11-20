# Send SaaS order forms and countersign them automatically (Node.js)

The customer picks a plan and signs, and your company countersigns with no human in the loop. Runs in test mode, needs no dependencies, and takes about a minute.

## The problem

A sales rep closes a deal and then waits for a founder or finance lead to countersign the order form. Deals sit in "signed by customer" for days.

An automatic signer applies your pre-authorized countersignature as soon as the envelope is created, so the customer signature is the last step.

## What you build

A small Node.js script (`index.mjs`) with two parts:

- `buildEnvelope()`: a pure function that returns the `POST /v1/envelopes` request body. No network, no clock, so it is easy to test.
- `send()` and `main()`: send it with the built-in `fetch` and print a summary.

API features shown: Automatic signer countersignature, dropdown with capture, checkbox, metadata.

The envelope shape and why:

- **Dropdown for the plan.** A `dropdown` place with custom options. `capture_as: "plan"` stores the choice in `captures`.
- **Automatic signer.** Your company is an `automatic_signer` with an uploaded signature image and a `mandate`. No email, no ceremony.
- **Terms checkbox.** A required `checkbox` for accepting the order terms.
- **Metadata.** `order_id` and `crm_deal` tie the envelope to your billing and CRM records.

## Prerequisites

- Node.js 20 or newer (uses the built-in `fetch` and `node:test`). No `npm install` needed.
- A SignatureAPI **test** API key. It starts with `key_test_`. Create one in the [dashboard](https://dashboard.signatureapi.com). The script refuses any other key.

## Step by step

1. **Set the key.** Export it. The script never prints it.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Upload the countersignature image.** `uploadMark()` posts the PNG to `POST /v1/uploads` and returns its `url`.
3. **Define the plan dropdown.** `options` is an array of `{ label, value }`. The signer sees the label, you read back the value.
4. **Add the automatic signer.** It needs `type`, `key`, `name`, `mandate`, and a `signature` object for every signature place it owns.
5. **Create the envelope.** The customer is invited right away. The countersignature is already applied.
6. **Send it.** `send()` calls `POST /v1/envelopes` with the `X-API-Key` header and returns the created envelope. A `201 Created` response carries the envelope `id` (a UUID) and its `recipients`.

The full request body this example sends (default values):

```json
{
  "title": "Order Form - Acme Corp Team Plan (sample)",
  "message": "Choose your plan, accept the terms and sign.",
  "routing": "sequential",
  "metadata": {
    "order_id": "ord_9001",
    "crm_deal": "deal_77"
  },
  "topics": [
    "sales",
    "order_forms"
  ],
  "documents": [
    {
      "key": "order_form",
      "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
      "format": "pdf",
      "fixed_positions": [
        {
          "place_key": "plan",
          "page": 1,
          "top": 130,
          "left": 210
        },
        {
          "place_key": "accept_terms",
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
          "place_key": "acme_countersignature",
          "page": 1,
          "top": 186,
          "left": 220
        }
      ],
      "places": [
        {
          "key": "plan",
          "type": "dropdown",
          "recipient_key": "customer",
          "prompt": "Plan",
          "options": [
            {
              "label": "Team",
              "value": "team"
            },
            {
              "label": "Business",
              "value": "business"
            }
          ],
          "width": 120,
          "capture_as": "plan"
        },
        {
          "key": "accept_terms",
          "type": "checkbox",
          "recipient_key": "customer",
          "requirement": "required",
          "capture_as": "accepted_terms"
        },
        {
          "key": "customer_signature",
          "type": "signature",
          "recipient_key": "customer"
        },
        {
          "key": "acme_countersignature",
          "type": "signature",
          "recipient_key": "acme"
        }
      ]
    }
  ],
  "recipients": [
    {
      "type": "signer",
      "key": "customer",
      "name": "Jane Doe",
      "email": "jane.doe@example.com"
    },
    {
      "type": "automatic_signer",
      "key": "acme",
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
cd use-cases/saas-order-forms
node index.mjs
# or: npm start
```

Optional: set `SIGNATUREAPI_BASE_URL` to point at another API host. The default is `https://api.signatureapi.com`.

## Expected output

```text
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient customer: signer (re_1sAAaVfabdt0esVjmSTm0)
  recipient acme: automatic_signer (re_1sAAaVfabdt0esVjmSTm1)
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
- **Legal weight.** An automatic signer does not interact with the document. The documentation notes that its evidentiary weight differs by jurisdiction. Ask your counsel before using it on high-risk documents.
- **`422` on dropdown options.** Each option needs a `label`. Use `value` for the machine-readable choice.

## Learn more

- [Send SaaS order forms and countersign them automatically: the guide](https://signatureapi.com/docs/use-cases/saas-order-forms)
- [Automatic signer](https://signatureapi.com/docs/api/resources/recipients/automatic-signer)
- [Dropdown place](https://signatureapi.com/docs/api/resources/places/dropdown)
- [Create an upload](https://signatureapi.com/docs/api/resources/uploads/create)
- [Envelope captures](https://signatureapi.com/docs/api/resources/envelopes/captures)
- [Signer recipient](https://signatureapi.com/docs/api/resources/recipients/signer)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## Files

- `index.mjs`
- `index.test.mjs`
- `package.json`
