# Create a signature envelope from an Airtable record with an automation script

When a record reaches the right state (for example Status is "Ready to send"), an Airtable automation runs a script that creates a SignatureAPI envelope for that record and returns the envelope id so a later step can store it. Test mode only.

## The problem

Contracts, onboarding forms and approvals often start as a row in Airtable. People then re-key the details into another tool to send them for signature. An automation with a "Run script" action can call the SignatureAPI REST API directly and remove that step.

## What you build

`script.js` has two parts:

- A **core** between the `---- core` and `---- end core ----` markers: `buildEnvelopePayload()` and `createEnvelope()`. Plain JavaScript with the HTTP function injected. No Airtable object is used.
- A **shim** of a few lines at the bottom that reads `input.config()` and the `apiKey` secret with `input.secret()`, calls the core with Airtable's `fetch`, and sets `output`.

## What was tested locally and what is platform glue

Tested on the host with `node --test` (no Airtable account involved):

- The core, extracted from the markers and run on its own: payload shape, the test-key guard, and API error handling.
- The whole `script.js` run as Airtable runs it (top-level `await`, with `input`, `input.secret()`, `output` and `fetch` provided by the test), first with a fake `fetch`, then with real `fetch` against a local mock HTTP server. Both check that the outputs `envelope_id` and `status` are set. Another test checks that a key passed as an input variable is never used.
- A live check against the API, only when `SIGNATUREAPI_KEY` is set. It is skipped otherwise.

Not tested here, because it needs Airtable: the automation trigger, the "Run script" action editor, its input variables and its Secrets feature, Airtable's own sandbox and its limits, and the next action that writes the id back to the record. Those steps follow Airtable's public documentation, linked below. Run the automation once on a test record to confirm them.

## Prerequisites

- An Airtable base with a table that has name and email fields.
- A SignatureAPI **test** API key (`key_test_YOUR_KEY`) from the [dashboard](https://dashboard.signatureapi.com).
- Node.js 20 or newer to run the tests (optional).

## Step by step

1. **Create the automation.** Pick a trigger such as "When a record matches conditions". See Airtable's [automations guide](https://support.airtable.com/docs/getting-started-with-airtable-automations).
2. **Add a "Run script" action.** In the action, define these input variables and map each to a field of the triggering record: `name`, `email`, `recordId`. The script reads them with [`input.config()`](https://airtable.com/developers/scripting/api/input). Do not add the key as an input variable.
3. **Paste `script.js`.** The script posts to `POST /v1/envelopes` using the `fetch` that Airtable's automation scripts provide, then returns values with [`output.set()`](https://airtable.com/developers/scripting/api/output).
4. **Keep the key in a secret.** Airtable's [Run script article](https://support.airtable.com/docs/run-a-script-action) says to store API keys with the **Secrets** feature in the script editor, not in the code. Add a secret named `apiKey` with your test key. The script reads it with [`input.secret()`](https://airtable.com/developers/scripting/api/secrets). Once a script uses a secret, only people with access to it can edit the script.
5. **Save the id.** Add an "Update record" action after the script and map its fields to the script outputs `envelope_id` and `status`.
6. **Test the step.** Use the "Test action" button on a record with a real-looking test email. The script fails with a clear message if the key is missing or is not a test key.

## Run the tests

```bash
npm test
```

## Expected output

```text
✔ core: the payload is a valid-shaped envelope with one signer and one place
✔ core: refuses a missing or live key
✔ core: an API error becomes a readable exception
✔ shim: the whole script reads input.config() and the apiKey secret, calls the API and sets the outputs
✔ shim: a key passed as an input variable is not used
✔ shim: the script works end to end against a local mock HTTP server using real fetch
﹣ live: the script creates a test-mode envelope (201 and a UUID id) # SIGNATUREAPI_KEY is not set, live test skipped
```

Inside Airtable the step outputs are:

```text
envelope_id: eb4cf433-a8af-4161-b37b-7ef57d423e56
status: processing
```

## Troubleshooting

- **"Add a secret named apiKey".** The secret is empty. If Airtable reports that the secret does not exist, add one named exactly `apiKey`.
- **"This example runs in test mode only".** The key must start with `key_test_`.
- **`422` from the API.** The email field is empty or malformed. Make the trigger condition require a valid email.
- **`fetch is not defined`.** Use the "Run script" action in an automation. Scripting blocks in an interface use a different function for HTTP calls.
- **A record triggers twice.** Add a condition such as "Envelope ID is empty" so each record sends once.

## Learn more

- [Use-case guides](https://signatureapi.com/docs/use-cases/overview) and the [create envelope reference](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Airtable integration guide](https://signatureapi.com/docs/integrations/airtable), including how to get the result back with a When webhook received trigger
- [Webhooks](https://signatureapi.com/docs/api/webhooks)
- [Organize with topics and metadata](https://signatureapi.com/docs/api/guides/how-to/organize-topics-metadata)
- [Test mode](https://signatureapi.com/docs/api/test-mode)
