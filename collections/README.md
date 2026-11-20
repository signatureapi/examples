# SignatureAPI collections for Postman, Bruno, Insomnia and HTTPie

Ready-to-import API collections for SignatureAPI, generated from the public [OpenAPI 3.1 spec](https://spec.signatureapi.com/openapi.yaml). Every documented endpoint is included, with a working request body and a test-mode environment.

## The problem

You want to try the e-signature API before you write code: create an envelope, read it back, replace a recipient, download a deliverable. Hand-built collections drift from the API. These are generated, so they match the spec.

## What you get

| Tool | Files | Import |
|---|---|---|
| Postman | `postman/signatureapi.postman_collection.json`, `postman/test-mode.postman_environment.json` | File > Import, select both files |
| Bruno | `bruno/` (a Bruno collection folder with a `test-mode` environment) | Open Collection, select the `bruno` folder |
| Insomnia | `insomnia/signatureapi.insomnia.json` | Import > From File |
| HTTPie | `httpie/signatureapi-httpie.sh` (one command per endpoint) | Copy the command you need |

Requests are grouped by resource: Envelopes, Recipients, Deliverables, Events, Uploads, Senders. Each request carries the endpoint description from the spec.

## Step by step

1. **Get a test API key.** [Sign up](https://accounts.signatureapi.com/sign-up) and copy your key from the dashboard. It starts with `key_test_`. Test envelopes are free and have no legal effect.
2. **Import the collection** for your tool (table above).
3. **Set the key.** Select the `SignatureAPI test mode` environment and replace `key_test_YOUR_KEY` in `api_key` with your key. Authentication is set once at the collection level: every request sends it in the `X-API-Key` header.
4. **Create an envelope.** Run *Envelopes > Create an envelope*. The body sends the sample Service Agreement to Jane Doe with one signature place. The response contains the envelope `id` (a UUID) and each recipient's `id` (it starts with `re_`).
5. **Chain the next calls.** Paste the recipient id into the `recipient_id` variable, then try *Recipients > Retrieve a recipient* or *Replace a recipient*. Do the same with `deliverable_id` once the envelope completes.

## Expected output

*Create an envelope* returns `201 Created`:

```json
{
  "id": "eb4cf433-a8af-4161-b37b-7ef57d423e56",
  "title": "Service Agreement",
  "status": "processing",
  "mode": "test",
  "recipients": [
    { "id": "re_3jZKq8vYw1X2a4Bc5Dd6Ef", "key": "client", "type": "signer", "name": "Jane Doe", "status": "pending" }
  ]
}
```

(Shortened. The full response includes documents, places, sender and timestamps.)

## How the collections are generated

`generate.mjs` reads the OpenAPI bundle, keeps the operations listed in `documented-operations.json` (the endpoints the public docs document), and writes all four formats. It has no dependencies and its output is deterministic, so a diff shows real API changes only.

```bash
curl -sSfo openapi.yaml https://spec.signatureapi.com/openapi.yaml
python3 -c "import json, yaml; json.dump(yaml.safe_load(open('openapi.yaml')), open('openapi.json', 'w'))"
node generate.mjs --bundle openapi.json
```

The nightly workflow does the same and fails when the committed collections are stale.

## Run the tests

```bash
npm test                                  # structure checks on the committed files
OPENAPI_BUNDLE=openapi.json npm test      # also checks every operation and body against the spec, and drift
```

## Troubleshooting

- **`401` on every request**: the environment is not selected, or `api_key` still holds the placeholder.
- **`404` on a recipient or deliverable request**: the `recipient_id` or `deliverable_id` variable is empty or belongs to another envelope.
- **`422` on Create an envelope after editing the body**: each place's `recipient_key` must match a recipient `key`, and each `fixed_positions` entry must name an existing place.
- **Create an upload sends nothing**: choose the file to upload in the request body first (PDF, DOCX or PNG, up to 4.5 MB).

## Learn more

- [Postman guide](https://signatureapi.com/docs/api/postman)
- [OpenAPI spec](https://signatureapi.com/docs/api/openapi)
- [Authentication](https://signatureapi.com/docs/api/authentication)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
