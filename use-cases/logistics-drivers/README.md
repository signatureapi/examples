# Send driver onboarding agreements by SMS link (Node.js)

Create an envelope with a short signing URL you can text to a driver. Runs in test mode, needs no dependencies, and takes about a minute.

## The problem

Drivers are on the road and often have no work email. They have a phone. You want to text them a link that opens the signing page directly.

An inline ceremony with `custom` authentication and `url_variant: "short"` makes SignatureAPI return a compact URL in the create response. You deliver it over your own SMS channel.

## What you build

A small Node.js script (`index.mjs`) with two parts:

- `buildEnvelope()`: a pure function that returns the `POST /v1/envelopes` request body. No network, no clock, so it is easy to test.
- `send()` and `main()`: send it with the built-in `fetch` and print a summary.

API features shown: Inline ceremony with custom authentication, short URL for SMS, delivery_type none.

The envelope shape and why:

- **Inline ceremony.** The `ceremony` object sits on the recipient. SignatureAPI creates it when the envelope starts processing, and `recipients[].ceremony.url` is in the response.
- **Short URL.** `url_variant: "short"` yields a link that fits in an SMS.
- **Custom authentication.** Your dispatch system vouches for the driver. `provider` and `data` land in the audit log. The data here records the channel and an opaque driver reference.
- **`delivery_type: "none"`.** No deliverable email. The recipient still needs an `email` for identification.

## Prerequisites

- Node.js 20 or newer (uses the built-in `fetch` and `node:test`). No `npm install` needed.
- A SignatureAPI **test** API key. It starts with `key_test_`. Create one in the [dashboard](https://dashboard.signatureapi.com). The script refuses any other key.

## Step by step

1. **Set the key.** Export it. The script never prints it.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Configure the recipient.** `delivery_type: "none"` plus a `ceremony` with `custom` authentication and `url_variant: "short"`.
3. **Create the envelope.** The response already contains `recipients[0].ceremony.url`.
4. **Compose the text.** `smsText(url)` builds the message. Send it through your SMS provider. Do not log the URL: it grants access to the ceremony.
5. **Track completion.** Use `recipient.completed` and `deliverable.generated` webhooks, then fetch the deliverable and store it yourself.
6. **Send it.** `send()` calls `POST /v1/envelopes` with the `X-API-Key` header and returns the created envelope. A `201 Created` response carries the envelope `id` (a UUID) and its `recipients`.

The full request body this example sends (default values):

```json
{
  "title": "Driver Agreement (sample)",
  "metadata": {
    "driver_ref": "drv_314"
  },
  "topics": [
    "logistics",
    "driver_onboarding"
  ],
  "documents": [
    {
      "key": "driver_agreement",
      "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
      "format": "pdf",
      "fixed_positions": [
        {
          "place_key": "safety_policy",
          "page": 1,
          "top": 140,
          "left": 210
        },
        {
          "place_key": "driver_initials",
          "page": 1,
          "top": 250,
          "left": 72
        },
        {
          "place_key": "driver_signature",
          "page": 1,
          "top": 172,
          "left": 210
        }
      ],
      "places": [
        {
          "key": "safety_policy",
          "type": "checkbox",
          "recipient_key": "driver",
          "requirement": "required",
          "capture_as": "safety_policy"
        },
        {
          "key": "driver_initials",
          "type": "initials",
          "recipient_key": "driver",
          "height": 30
        },
        {
          "key": "driver_signature",
          "type": "signature",
          "recipient_key": "driver"
        }
      ]
    }
  ],
  "recipients": [
    {
      "type": "signer",
      "key": "driver",
      "name": "Maria Garcia",
      "email": "maria.garcia@example.com",
      "delivery_type": "none",
      "ceremony": {
        "authentication": [
          {
            "type": "custom",
            "provider": "Acme Dispatch SMS",
            "data": {
              "channel": "sms",
              "driver_ref": "drv_314"
            }
          }
        ],
        "url_variant": "short"
      }
    }
  ]
}
```

## Run it

```bash
cd use-cases/logistics-drivers
node index.mjs
# or: npm start
```

Optional: set `SIGNATUREAPI_BASE_URL` to point at another API host. The default is `https://api.signatureapi.com`.

## Expected output

```text
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient driver: signer (re_1sAAaVfabdt0esVjmSTm0)
  ceremony for driver: https://sign.signatureapi.com/s/... (52 chars, a bearer link: never log it in full)
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
- **`ceremony.url` is null.** Only `custom` and `email_code` first methods return a URL in the response.
- **The link is too long for your SMS gateway.** Check `url_variant` is `short`.

## Learn more

- [Send driver onboarding agreements by SMS link: the guide](https://signatureapi.com/docs/use-cases/logistics-drivers)
- [Send signing links via SMS](https://signatureapi.com/docs/api/guides/use-cases/sms-signing-link)
- [Custom authentication](https://signatureapi.com/docs/api/resources/ceremonies/authentication/custom)
- [Ceremony URL](https://signatureapi.com/docs/api/resources/ceremonies/ceremony-url)
- [Save signed documents](https://signatureapi.com/docs/api/guides/use-cases/save-signed-documents)
- [Webhooks](https://signatureapi.com/docs/api/webhooks)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## Files

- `index.mjs`
- `index.test.mjs`
- `package.json`
