# Sign service contracts on a store tablet with an embedded ceremony (Node.js)

Show the contract in an iframe on a store device, with a code check by email. Runs in test mode, needs no dependencies, and takes about a minute.

## The problem

A customer signs a service contract at the counter. The clerk has a tablet and the customer has an email address, not a login. You want signing to happen right there, with a check that the customer owns the email.

A ceremony with `email_code` authentication returns a URL you can embed, and SignatureAPI emails the customer a code they must enter first.

## What you build

A small Node.js script (`index.mjs`) with two parts:

- `buildEnvelope()`: a pure function that returns the `POST /v1/envelopes` request body. No network, no clock, so it is easy to test.
- `send()` and `main()`: send it with the built-in `fetch` and print a summary.

API features shown: Embedded ceremony via POST /v1/recipients/{id}/ceremonies, email code authentication, short URL.

The envelope shape and why:

- **Ceremony created after the envelope.** `POST /v1/recipients/{recipient_id}/ceremonies` with `authentication: [{ "type": "email_code" }]`.
- **The URL comes back immediately.** For `email_code` (and `custom`) the response includes `url`. With `email_link` first, SignatureAPI emails it instead.
- **`embeddable_in` and `url_variant`.** The store app origin may frame the ceremony. A `short` URL is easy to show as a QR code.
- **A plan dropdown and initials.** The customer picks a plan, initials the fee schedule and signs.

## Prerequisites

- Node.js 20 or newer (uses the built-in `fetch` and `node:test`). No `npm install` needed.
- A SignatureAPI **test** API key. It starts with `key_test_`. Create one in the [dashboard](https://dashboard.signatureapi.com). The script refuses any other key.

## Step by step

1. **Set the key.** Export it. The script never prints it.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Create the envelope.** The customer has `delivery_type: "none"` so no deliverable email goes out. Your store system prints or stores the copy.
3. **Wait for readiness.** `waitUntilReady()` polls the envelope until it is no longer `processing`.
4. **Create the ceremony.** `buildCeremony()` returns `email_code` authentication, `embeddable_in` and `url_variant: "short"`.
5. **Embed it.** `embedSrc(url)` adds `embedded=true` and `event_delivery=message`. Listen for `ceremony.completed`.
6. **Send it.** `send()` calls `POST /v1/envelopes` with the `X-API-Key` header and returns the created envelope. A `201 Created` response carries the envelope `id` (a UUID) and its `recipients`.

The script makes a second call, `POST /v1/recipients/{recipient_id}/ceremonies`, after the envelope is ready. The ceremony URL is a bearer link, so the script prints only its first characters.

The full request body this example sends (default values):

```json
{
  "title": "Service Contract (sample)",
  "metadata": {
    "order_id": "ord_telco_1",
    "store_id": "store_12"
  },
  "topics": [
    "telecom",
    "service_contracts"
  ],
  "documents": [
    {
      "key": "service_contract",
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
          "place_key": "fee_initials",
          "page": 1,
          "top": 250,
          "left": 72
        },
        {
          "place_key": "customer_signature",
          "page": 1,
          "top": 172,
          "left": 210
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
              "label": "Basic",
              "value": "basic"
            },
            {
              "label": "Unlimited",
              "value": "unlimited"
            }
          ],
          "width": 120,
          "capture_as": "plan"
        },
        {
          "key": "fee_initials",
          "type": "initials",
          "recipient_key": "customer",
          "height": 30
        },
        {
          "key": "customer_signature",
          "type": "signature",
          "recipient_key": "customer"
        }
      ]
    }
  ],
  "recipients": [
    {
      "type": "signer",
      "key": "customer",
      "name": "John Smith",
      "email": "john.smith@example.com",
      "delivery_type": "none"
    }
  ]
}
```

## Run it

```bash
cd use-cases/telecom
node index.mjs
# or: npm start
```

Optional: set `SIGNATUREAPI_BASE_URL` to point at another API host. The default is `https://api.signatureapi.com`.

## Expected output

```text
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient customer: signer (re_1sAAaVfabdt0esVjmSTm0)
  ceremony for customer: https://sign.signatureapi.com/en... (68 chars, a bearer link: never log it in full)
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
- **The customer does not get the code.** The code goes to the email on the recipient. In test mode no email is sent: open the dashboard Email view in test mode.
- **The iframe is blocked.** `embeddable_in` must contain your exact origin.

## Learn more

- [Sign service contracts on a store tablet with an embedded ceremony: the guide](https://signatureapi.com/docs/use-cases/telecom)
- [Email code authentication](https://signatureapi.com/docs/api/resources/ceremonies/authentication/email-code)
- [Create a ceremony](https://signatureapi.com/docs/api/resources/ceremonies/create)
- [Embed signing in a web app](https://signatureapi.com/docs/api/guides/how-to/embed-web)
- [Ceremony URL](https://signatureapi.com/docs/api/resources/ceremonies/ceremony-url)
- [Test mode](https://signatureapi.com/docs/api/test-mode)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## Files

- `index.mjs`
- `index.test.mjs`
- `package.json`
