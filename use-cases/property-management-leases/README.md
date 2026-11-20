# Collect lease signatures from tenants and landlord in parallel (Node.js)

Let two tenants and a landlord sign a lease in any order. Runs in test mode, needs no dependencies, and takes about a minute.

## The problem

A lease usually has more than one tenant plus the landlord. Nobody needs to wait for anybody else, but you do need all signatures before move-in. Passing a PDF around in sequence wastes days.

Parallel routing sends the request to everyone at the same time. The envelope completes when the last person finishes.

## What you build

A small Node.js script (`index.mjs`) with two parts:

- `buildEnvelope()`: a pure function that returns the `POST /v1/envelopes` request body. No network, no clock, so it is easy to test.
- `send()` and `main()`: send it with the built-in `fetch` and print a summary.

API features shown: Parallel routing, three signers, initials, metadata, topics.

The envelope shape and why:

- **Parallel routing.** `routing: "parallel"` invites all recipients at once, in any order.
- **Three signers.** Two tenants and the landlord representative, each with a signature place. The tenants also initial the pet policy.
- **Fixed positions.** All places are anchored by coordinates on the sample PDF.
- **Correlation.** `metadata.lease_id` and `metadata.unit` identify the lease. `topics` split new leases from renewals.

## Prerequisites

- Node.js 20 or newer (uses the built-in `fetch` and `node:test`). No `npm install` needed.
- A SignatureAPI **test** API key. It starts with `key_test_`. Create one in the [dashboard](https://dashboard.signatureapi.com). The script refuses any other key.

## Step by step

1. **Set the key.** Export it. The script never prints it.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Set parallel routing.** Add `"routing": "parallel"` at the top level of the envelope. Without it the default is sequential.
3. **Add every signer.** Two tenants and one landlord rep. The array order no longer decides who goes first.
4. **Add signature and initials places.** Each place has a unique `key` and points at one recipient.
5. **Track completion.** Listen for `envelope.completed` to know the lease is fully signed.
6. **Send it.** `send()` calls `POST /v1/envelopes` with the `X-API-Key` header and returns the created envelope. A `201 Created` response carries the envelope `id` (a UUID) and its `recipients`.

The full request body this example sends (default values):

```json
{
  "title": "Residential Lease (sample)",
  "message": "Please review and sign the lease. Everyone can sign in any order.",
  "routing": "parallel",
  "metadata": {
    "lease_id": "lease_3310",
    "unit": "unit_4b"
  },
  "topics": [
    "leasing",
    "new_leases"
  ],
  "documents": [
    {
      "key": "lease",
      "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
      "format": "pdf",
      "fixed_positions": [
        {
          "place_key": "tenant_one_signature",
          "page": 1,
          "top": 172,
          "left": 210
        },
        {
          "place_key": "tenant_two_signature",
          "page": 1,
          "top": 214,
          "left": 210
        },
        {
          "place_key": "landlord_signature",
          "page": 1,
          "top": 186,
          "left": 220
        },
        {
          "place_key": "tenant_one_initials",
          "page": 1,
          "top": 250,
          "left": 72
        },
        {
          "place_key": "tenant_two_initials",
          "page": 1,
          "top": 250,
          "left": 140
        }
      ],
      "places": [
        {
          "key": "tenant_one_signature",
          "type": "signature",
          "recipient_key": "tenant_one"
        },
        {
          "key": "tenant_two_signature",
          "type": "signature",
          "recipient_key": "tenant_two"
        },
        {
          "key": "landlord_signature",
          "type": "signature",
          "recipient_key": "landlord"
        },
        {
          "key": "tenant_one_initials",
          "type": "initials",
          "recipient_key": "tenant_one",
          "height": 30
        },
        {
          "key": "tenant_two_initials",
          "type": "initials",
          "recipient_key": "tenant_two",
          "height": 30
        }
      ]
    }
  ],
  "recipients": [
    {
      "type": "signer",
      "key": "tenant_one",
      "name": "Jane Doe",
      "email": "jane.doe@example.com"
    },
    {
      "type": "signer",
      "key": "tenant_two",
      "name": "John Smith",
      "email": "john.smith@example.com"
    },
    {
      "type": "signer",
      "key": "landlord",
      "name": "Maria Garcia",
      "email": "maria.garcia@example.com"
    }
  ]
}
```

## Run it

```bash
cd use-cases/property-management-leases
node index.mjs
# or: npm start
```

Optional: set `SIGNATUREAPI_BASE_URL` to point at another API host. The default is `https://api.signatureapi.com`.

## Expected output

```text
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient tenant_one: signer (re_1sAAaVfabdt0esVjmSTm0)
  recipient tenant_two: signer (re_1sAAaVfabdt0esVjmSTm1)
  recipient landlord: signer (re_1sAAaVfabdt0esVjmSTm2)
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
- **Signers are invited one by one.** The envelope is sequential. Set `routing` to `parallel`.
- **One tenant never signs.** The envelope stays `in_progress`. Use the resend endpoint for that recipient or replace the recipient if the address is wrong.

## Learn more

- [Collect lease signatures from tenants and landlord in parallel: the guide](https://signatureapi.com/docs/use-cases/property-management-leases)
- [Parallel signing](https://signatureapi.com/docs/api/guides/how-to/parallel-signing)
- [Routing](https://signatureapi.com/docs/api/resources/envelopes/routing)
- [Initials place](https://signatureapi.com/docs/api/resources/places/initials)
- [Resend a request](https://signatureapi.com/docs/api/resources/recipients/resend)
- [Envelope events](https://signatureapi.com/docs/api/resources/events/envelope-events)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## Files

- `index.mjs`
- `index.test.mjs`
- `package.json`
