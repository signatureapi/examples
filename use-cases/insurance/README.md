# Embed policy signing in your insurance portal (Node.js)

Create an envelope, then mint an embeddable ceremony for the policyholder with a server-side call. Runs in test mode, needs no dependencies, and takes about a minute.

## The problem

A policyholder is already logged in to your portal when they accept a policy. Sending them an email to sign breaks the flow and loses conversions.

You can embed the signing ceremony in an iframe in your own app. Your server creates the envelope, then asks SignatureAPI for a ceremony URL for that recipient.

## What you build

A small Node.js script (`index.mjs`) with two parts:

- `buildEnvelope()`: a pure function that returns the `POST /v1/envelopes` request body. No network, no clock, so it is easy to test.
- `send()` and `main()`: send it with the built-in `fetch` and print a summary.

API features shown: Embedded ceremony via POST /v1/recipients/{id}/ceremonies, custom authentication, embeddable_in.

The envelope shape and why:

- **`delivery_type: "none"`.** The policyholder gets no deliverable email. Your portal is responsible for showing or storing the signed documents.
- **Create the ceremony after the envelope.** `POST /v1/recipients/{recipient_id}/ceremonies` with `custom` authentication returns a ceremony `url` right away. Your app has already authenticated the user, and `authentication.data` records how.
- **`embeddable_in`.** The origins allowed to frame the ceremony. Without it the browser blocks the iframe.
- **Client side.** Append `embedded=true&event_delivery=message` to the URL and listen for `ceremony.completed` messages. Check `event.origin` and `event.source`.

## Prerequisites

- Node.js 20 or newer (uses the built-in `fetch` and `node:test`). No `npm install` needed.
- A SignatureAPI **test** API key. It starts with `key_test_`. Create one in the [dashboard](https://dashboard.signatureapi.com). The script refuses any other key.

## Step by step

1. **Set the key.** Export it. The script never prints it.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Create the envelope.** The signer has `delivery_type: "none"`. The request has no `ceremony`, so nothing is emailed.
3. **Wait until the envelope is ready.** A new envelope is `processing` for a moment. `waitUntilReady()` polls `GET /v1/envelopes/{id}` until it is not.
4. **Create the ceremony.** `buildCeremony()` returns `authentication` with a `custom` method (provider and data are recorded in the audit log) plus `embeddable_in`.
5. **Hand the URL to the browser.** `embedSrc(url)` adds the two required query parameters. The URL is a bearer link: never log it or store it in analytics.
6. **Send it.** `send()` calls `POST /v1/envelopes` with the `X-API-Key` header and returns the created envelope. A `201 Created` response carries the envelope `id` (a UUID) and its `recipients`.

The script makes a second call, `POST /v1/recipients/{recipient_id}/ceremonies`, after the envelope is ready. The ceremony URL is a bearer link, so the script prints only its first characters.

The full request body this example sends (default values):

```json
{
  "title": "Policy Application (sample)",
  "metadata": {
    "application_id": "app_6620"
  },
  "topics": [
    "insurance",
    "policy_applications"
  ],
  "documents": [
    {
      "key": "policy_application",
      "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
      "format": "pdf",
      "fixed_positions": [
        {
          "place_key": "disclosure_ack",
          "page": 1,
          "top": 140,
          "left": 210
        },
        {
          "place_key": "policyholder_signature",
          "page": 1,
          "top": 172,
          "left": 210
        }
      ],
      "places": [
        {
          "key": "disclosure_ack",
          "type": "checkbox",
          "recipient_key": "policyholder",
          "requirement": "required",
          "capture_as": "disclosure_ack"
        },
        {
          "key": "policyholder_signature",
          "type": "signature",
          "recipient_key": "policyholder"
        }
      ]
    }
  ],
  "recipients": [
    {
      "type": "signer",
      "key": "policyholder",
      "name": "Jane Doe",
      "email": "jane.doe@example.com",
      "delivery_type": "none"
    }
  ]
}
```

## Run it

```bash
cd use-cases/insurance
node index.mjs
# or: npm start
```

Optional: set `SIGNATUREAPI_BASE_URL` to point at another API host. The default is `https://api.signatureapi.com`.

## Expected output

```text
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient policyholder: signer (re_1sAAaVfabdt0esVjmSTm0)
  ceremony for policyholder: https://sign.signatureapi.com/en... (68 chars, a bearer link: never log it in full)
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
- **The iframe is blank or blocked.** `embeddable_in` must include the exact origin of your page, and the URL needs `embedded=true`.
- **`url` is `null` in the ceremony response.** The first authentication method decides. `custom` and `email_code` return a URL. `email_link` makes SignatureAPI email it instead.
- **No `ceremony.completed` message.** You also need `event_delivery=message` in the iframe URL.

## Learn more

- [Embed policy signing in your insurance portal: the guide](https://signatureapi.com/docs/use-cases/insurance)
- [Embed signing in a web app](https://signatureapi.com/docs/api/guides/how-to/embed-web)
- [Create a ceremony](https://signatureapi.com/docs/api/resources/ceremonies/create)
- [Custom authentication](https://signatureapi.com/docs/api/resources/ceremonies/authentication/custom)
- [Embed in a mobile app](https://signatureapi.com/docs/api/guides/how-to/embed-mobile)
- [Ceremony lifecycle](https://signatureapi.com/docs/api/resources/ceremonies/lifecycle)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## Files

- `index.mjs`
- `index.test.mjs`
- `package.json`
