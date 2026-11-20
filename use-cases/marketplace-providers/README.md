# Embed provider onboarding agreements in your marketplace (Node.js)

Sign provider agreements inside your app and send the provider back to onboarding when done. Runs in test mode, needs no dependencies, and takes about a minute.

## The problem

A marketplace onboards service providers inside its own app. A provider who must leave for an email, sign, and come back often never returns.

Your server creates the envelope and a ceremony. The provider signs in an iframe, and `redirect_url` returns them to the next onboarding step.

## What you build

A small Node.js script (`index.mjs`) with two parts:

- `buildEnvelope()`: a pure function that returns the `POST /v1/envelopes` request body. No network, no clock, so it is easy to test.
- `send()` and `main()`: send it with the built-in `fetch` and print a summary.

API features shown: Embedded ceremony via POST /v1/recipients/{id}/ceremonies, redirect URL, tenant metadata.

The envelope shape and why:

- **Create the ceremony after the envelope.** `POST /v1/recipients/{recipient_id}/ceremonies` with `custom` authentication. The URL comes back in the response.
- **`redirect_url` and `redirect_delay`.** An HTTPS URL to continue to after signing, with a delay from 0 to 20 seconds. For an embedded ceremony the delay applies before the completion event.
- **Tenant metadata.** `tenant_id` and `provider_id` correlate webhook events with the right marketplace tenant.
- **A captured field.** The provider enters a business name in a `text_input` place with `capture_as`.

## Prerequisites

- Node.js 20 or newer (uses the built-in `fetch` and `node:test`). No `npm install` needed.
- A SignatureAPI **test** API key. It starts with `key_test_`. Create one in the [dashboard](https://dashboard.signatureapi.com). The script refuses any other key.

## Step by step

1. **Set the key.** Export it. The script never prints it.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Create the envelope.** The provider has `delivery_type: "none"`. No ceremony is configured at this point.
3. **Wait for readiness.** `waitUntilReady()` polls until the envelope leaves `processing`.
4. **Create the ceremony.** Custom authentication plus `embeddable_in`, `redirect_url` and `redirect_delay`.
5. **Embed and listen.** Show the URL in an iframe with `embedded=true&event_delivery=message` and listen for `ceremony.completed`.
6. **Correlate on the server.** Webhook payloads include `envelope_metadata`. Use `tenant_id` to route the event.
7. **Send it.** `send()` calls `POST /v1/envelopes` with the `X-API-Key` header and returns the created envelope. A `201 Created` response carries the envelope `id` (a UUID) and its `recipients`.

The script makes a second call, `POST /v1/recipients/{recipient_id}/ceremonies`, after the envelope is ready. The ceremony URL is a bearer link, so the script prints only its first characters.

The full request body this example sends (default values):

```json
{
  "title": "Provider Agreement (sample)",
  "metadata": {
    "tenant_id": "tenant_abc123",
    "provider_id": "prov_204"
  },
  "topics": [
    "marketplace",
    "provider_onboarding"
  ],
  "documents": [
    {
      "key": "provider_agreement",
      "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
      "format": "pdf",
      "fixed_positions": [
        {
          "place_key": "business_name",
          "page": 1,
          "top": 140,
          "left": 210
        },
        {
          "place_key": "provider_signature",
          "page": 1,
          "top": 172,
          "left": 210
        }
      ],
      "places": [
        {
          "key": "business_name",
          "type": "text_input",
          "recipient_key": "provider",
          "prompt": "Business name",
          "width": 220,
          "capture_as": "business_name"
        },
        {
          "key": "provider_signature",
          "type": "signature",
          "recipient_key": "provider"
        }
      ]
    }
  ],
  "recipients": [
    {
      "type": "signer",
      "key": "provider",
      "name": "Maria Garcia",
      "email": "maria.garcia@example.com",
      "delivery_type": "none"
    }
  ]
}
```

## Run it

```bash
cd use-cases/marketplace-providers
node index.mjs
# or: npm start
```

Optional: set `SIGNATUREAPI_BASE_URL` to point at another API host. The default is `https://api.signatureapi.com`.

## Expected output

```text
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient provider: signer (re_1sAAaVfabdt0esVjmSTm0)
  ceremony for provider: https://sign.signatureapi.com/en... (68 chars, a bearer link: never log it in full)
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
- **`422` on `redirect_url`.** It must be an HTTPS URL.
- **The provider is redirected before they finish.** Redirect happens only after the ceremony ends. Check the delay value.

## Learn more

- [Embed provider onboarding agreements in your marketplace: the guide](https://signatureapi.com/docs/use-cases/marketplace-providers)
- [Multi-tenant applications](https://signatureapi.com/docs/api/guides/use-cases/multi-tenant)
- [Embed signing in a web app](https://signatureapi.com/docs/api/guides/how-to/embed-web)
- [Create a ceremony](https://signatureapi.com/docs/api/resources/ceremonies/create)
- [Redirect URL](https://signatureapi.com/docs/api/resources/ceremonies/redirect-url)
- [Organize with topics and metadata](https://signatureapi.com/docs/api/guides/how-to/organize-topics-metadata)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## Files

- `index.mjs`
- `index.test.mjs`
- `package.json`
