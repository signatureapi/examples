# Collect volunteer waivers from a volunteer and a guardian (Node.js)

Send a branded waiver that the volunteer and a guardian sign in any order. Runs in test mode, needs no dependencies, and takes about a minute.

## The problem

A nonprofit signs up volunteers for every event, and minors need a guardian signature too. Paper waivers get lost and event coordinators spend the morning chasing them.

A parallel envelope lets both people sign when they have a minute, and the waiver arrives branded with your organization colors.

## What you build

A small Node.js script (`index.mjs`) with two parts:

- `buildEnvelope()`: a pure function that returns the `POST /v1/envelopes` request body. No network, no clock, so it is easy to test.
- `send()` and `main()`: send it with the built-in `fetch` and print a summary.

API features shown: Parallel routing, initials and signature, branding, topics.

The envelope shape and why:

- **Parallel routing.** The volunteer and the guardian are invited together.
- **Initials and signature.** The volunteer initials the risk acknowledgement and signs. The guardian signs.
- **Branding.** `branding.accent_color` and `branding.email` (footer, logo position) make emails and the ceremony look like your organization.
- **Topics.** `volunteers` and `waivers` let you route the completion webhook to your volunteer database.

## Prerequisites

- Node.js 20 or newer (uses the built-in `fetch` and `node:test`). No `npm install` needed.
- A SignatureAPI **test** API key. It starts with `key_test_`. Create one in the [dashboard](https://dashboard.signatureapi.com). The script refuses any other key.

## Step by step

1. **Set the key.** Export it. The script never prints it.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Set the routing and the branding.** `routing: "parallel"`. `branding.accent_color` takes a hex color. `branding.email.footer` accepts Markdown text.
3. **Add the recipients.** Volunteer and guardian, both `signer`.
4. **Add the places.** Initials and signature for the volunteer, signature for the guardian.
5. **Tag by event.** `metadata.event_id` names the event so you can count waivers per event.
6. **Send it.** `send()` calls `POST /v1/envelopes` with the `X-API-Key` header and returns the created envelope. A `201 Created` response carries the envelope `id` (a UUID) and its `recipients`.

The full request body this example sends (default values):

```json
{
  "title": "Volunteer Waiver (sample)",
  "message": "Thank you for volunteering. Please review and sign the waiver.",
  "routing": "parallel",
  "metadata": {
    "event_id": "evt_2027_spring_cleanup"
  },
  "topics": [
    "volunteers",
    "waivers"
  ],
  "branding": {
    "accent_color": "#2e7d32",
    "email": {
      "footer": "Acme Corp Foundation (synthetic example)",
      "logo_position": "center"
    }
  },
  "documents": [
    {
      "key": "waiver",
      "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
      "format": "pdf",
      "fixed_positions": [
        {
          "place_key": "volunteer_initials",
          "page": 1,
          "top": 250,
          "left": 72
        },
        {
          "place_key": "volunteer_signature",
          "page": 1,
          "top": 172,
          "left": 210
        },
        {
          "place_key": "guardian_signature",
          "page": 1,
          "top": 186,
          "left": 220
        }
      ],
      "places": [
        {
          "key": "volunteer_initials",
          "type": "initials",
          "recipient_key": "volunteer",
          "height": 30
        },
        {
          "key": "volunteer_signature",
          "type": "signature",
          "recipient_key": "volunteer"
        },
        {
          "key": "guardian_signature",
          "type": "signature",
          "recipient_key": "guardian"
        }
      ]
    }
  ],
  "recipients": [
    {
      "type": "signer",
      "key": "volunteer",
      "name": "Maria Garcia",
      "email": "maria.garcia@example.com"
    },
    {
      "type": "signer",
      "key": "guardian",
      "name": "Jane Doe",
      "email": "jane.doe@example.com"
    }
  ]
}
```

## Run it

```bash
cd use-cases/nonprofit-volunteers
node index.mjs
# or: npm start
```

Optional: set `SIGNATUREAPI_BASE_URL` to point at another API host. The default is `https://api.signatureapi.com`.

## Expected output

```text
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient volunteer: signer (re_1sAAaVfabdt0esVjmSTm0)
  recipient guardian: signer (re_1sAAaVfabdt0esVjmSTm1)
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
- **`422` on the accent color.** Use a six-digit hex color such as `#2e7d32`.
- **Logo not showing.** Pass `branding.logo` as an HTTPS URL to a public image. This example omits it.

## Learn more

- [Collect volunteer waivers from a volunteer and a guardian: the guide](https://signatureapi.com/docs/use-cases/nonprofit-volunteers)
- [Customize branding](https://signatureapi.com/docs/api/guides/how-to/customize-branding)
- [Branding reference](https://signatureapi.com/docs/api/resources/envelopes/branding)
- [Parallel signing](https://signatureapi.com/docs/api/guides/how-to/parallel-signing)
- [Initials place](https://signatureapi.com/docs/api/resources/places/initials)
- [Topics](https://signatureapi.com/docs/api/resources/envelopes/topics)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## Files

- `index.mjs`
- `index.test.mjs`
- `package.json`
