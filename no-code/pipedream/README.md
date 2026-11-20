# Create a signature envelope from a Pipedream workflow event (Node.js code step)

A Pipedream workflow receives an event (a webhook call, a form submission, a new CRM row) and a Node.js code step creates a SignatureAPI envelope from it. Test mode only.

## The problem

Events that should start a signature already flow through Pipedream. Wiring each one to a signing tool by hand means copying fields and clicking through UIs. One code step can turn the event into an envelope and export the envelope id to the next step.

## What you build

`step.mjs` is one file you paste into a "Run Node.js code" step. It has two parts:

- A **core** between the `---- core` and `---- end core ----` markers: `buildEnvelopePayload(event)` and `createEnvelope(cfg, payload)`. Plain JavaScript using the global `fetch`. No Pipedream object is used.
- A **shim** that uses Pipedream's documented component shape: `export default defineComponent({ props, async run({ steps, $ }) { ... } })`. It reads the trigger event from `steps.trigger.event`, takes the key from a secret prop, and exports the result with `$.export`.

## What was tested locally and what is platform glue

Tested on the host with `node --test` (no Pipedream account involved):

- The core, extracted from the markers and run on its own: payload shape, the test-key guard, and API error handling.
- The real `step.mjs` imported with `defineComponent` stubbed as an identity function, then `run()` called with a fake `steps`, `$` and `this` props against a local mock HTTP server. It checks the request, the exported values and the error path.
- A live check against the API, only when `SIGNATUREAPI_KEY` is set. It is skipped otherwise.

Not tested here, because it needs Pipedream: the workflow editor, the trigger, how props render in the UI, secret storage, and Pipedream's runtime itself. The component shape follows Pipedream's public documentation, linked below. Run the workflow once with a test event to confirm it.

## Prerequisites

- A Pipedream account and a workflow with a trigger that yields `name` and `email` (and an `id`).
- A SignatureAPI **test** API key (`key_test_YOUR_KEY`) from the [dashboard](https://dashboard.signatureapi.com).
- Node.js 20 or newer to run the tests (optional).

## Step by step

1. **Add a Node.js code step** after your trigger. See Pipedream's [Node.js code guide](https://pipedream.com/docs/workflows/building-workflows/code/nodejs/).
2. **Paste `step.mjs`.** The step uses the [component format](https://pipedream.com/docs/components/contributing/api/): `props` become form fields, and `run` receives `{ steps, $ }`.
3. **Fill the props.** `signatureapi_key` is marked `secret: true`, so Pipedream treats it as a secret. Paste a test key. Leave `base_url` empty.
4. **Map the event.** The step reads `steps.trigger.event.body` when present (an HTTP trigger) and the event itself otherwise. It expects `id`, `name` and `email`. Change `buildEnvelopePayload` if your event uses other field names.
5. **Test the step.** Use "Test" with a sample event. The step calls `POST /v1/envelopes`, returns `{ id, status }`, and exports `envelope_id` and `status` for later steps with [`$.export`](https://pipedream.com/docs/components/contributing/api/#export).

## Run the tests

```bash
npm test
```

## Expected output

```text
✔ core: the payload is a valid-shaped envelope with one signer and one place
✔ core: refuses a missing or live key
✔ shim: the component has the documented shape (props and an async run)
✔ shim: run() reads the trigger event, creates the envelope and exports the id
✔ shim: an API error surfaces as a failed step
﹣ live: the step creates a test-mode envelope (201 and a UUID id) # SIGNATUREAPI_KEY is not set, live test skipped
```

The step returns and exports:

```text
{ "id": "eb4cf433-a8af-4161-b37b-7ef57d423e56", "status": "processing" }
```

## Troubleshooting

- **"Set the signatureapi_key prop".** The prop is empty.
- **"This example runs in test mode only".** The key must start with `key_test_`.
- **`defineComponent is not defined`.** That name exists only inside Pipedream. Do not run `step.mjs` with plain Node.js. Use `npm test`, which stubs it.
- **`422` from the API.** The event has no valid `email`. Add a filter step before this one.
- **Receiving the result.** Use a Pipedream HTTP trigger as the endpoint for SignatureAPI webhooks. Verify the Standard Webhooks signature before acting on the body. See the verify-webhooks examples in this repository.

## Learn more

- [Use-case guides](https://signatureapi.com/docs/use-cases/overview) and the [create envelope reference](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Webhooks](https://signatureapi.com/docs/api/webhooks) and [set up webhooks](https://signatureapi.com/docs/api/guides/how-to/set-up-webhooks)
- [Organize with topics and metadata](https://signatureapi.com/docs/api/guides/how-to/organize-topics-metadata)
- [Test mode](https://signatureapi.com/docs/api/test-mode)
