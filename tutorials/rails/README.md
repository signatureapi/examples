# Ruby on Rails e-signature tutorial: send, embed and track a contract with webhooks

A complete Rails app that sends a contract for signature, lets the user sign it inside your page (embedded ceremony), and tracks the result with verified webhooks processed by an Active Job.

## The problem

Most e-signature integrations need three things working together: a server call that creates the envelope, a signing experience that keeps users in your product, and a reliable way to learn when signing is done. Getting any one wrong leaks your API key, breaks the iframe, or trusts forged webhook calls.

## What you build

A small API-only Rails app (three controllers, one job and one client module, about 150 lines; the HTTP calls use `Net::HTTP` from the standard library):

| Route | Purpose |
|---|---|
| `GET /` | A page with a form and the ceremony iframe |
| `POST /api/contracts` | Creates the envelope on the server and returns the ceremony URL |
| `GET /api/contracts/{id}` | Confirms the envelope status on the server |
| `GET /api/contracts/{id}/signed.pdf` | Streams the signed PDF (the deliverable) through your server |
| `POST /webhooks/signatureapi` | Receives events, verifies the signature on the raw body, dedupes retries |

`app/lib/signature_api.rb` holds the API client, the envelope builder, the signing session and the Standard Webhooks verifier. `app/jobs/signatureapi_event_job.rb` records each event in the background. `app/models/contract_store.rb` is the in-memory store.

## Prerequisites

- Ruby 3.3 or newer (the tested version is in `.ruby-version`) and Bundler.
- A SignatureAPI test API key (`key_test_...`). [Sign up](https://accounts.signatureapi.com/sign-up) for free.
- For webhooks on your machine: a webhook endpoint in the [dashboard](https://dashboard.signatureapi.com/settings/webhooks) pointing at a public tunnel, or `npx signatureapi listen` from the [SignatureAPI CLI](https://signatureapi.com/docs/cli/webhooks), which forwards test events and saves the signing secret.

## Step by step

### 1. Create the envelope on your server

The browser never sees your API key. `POST /api/contracts` calls `create_signing_session`, which sends the envelope built by `build_contract` with three recipient options for embedding:

```ruby
recipients: [{
  key: "client", type: "signer", name: name, email: email,
  delivery_type: "none", # your app shows the result; no emails
  ceremony: {
    authentication: [{ type: "custom", provider: "Acme Corp Portal", data: { user_id: user_id } }],
    embeddable_in: [@app_origin] # the origin allowed to frame the ceremony
  }
}]
```

`custom` authentication records that your app already signed the user in, so the ceremony URL comes back in the response at `recipients[0].ceremony.url`.

The envelope starts in `processing`, and the ceremony opens only once it is `in_progress`. `create_signing_session` reads the envelope once a second until then and returns the ceremony URL from that read.

### 2. Embed the ceremony

``app/views/index.html`` adds the two required query parameters and loads the URL in an iframe:

```js
src.searchParams.set('embedded', 'true');
src.searchParams.set('event_delivery', 'message');
```

It accepts `message` events only when `event.origin` is `https://sign.signatureapi.com` and `event.source` is the iframe. A `ceremony.completed` message is a UI signal, so the page then asks your server for the real status.

### 3. Verify webhooks on the raw body

SignatureAPI signs each delivery with the [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks) scheme. `SignatureApi.verify_webhook` computes an HMAC-SHA256 over `webhook-id.webhook-timestamp.body` with your signing secret, compares in constant time, and rejects timestamps older than 5 minutes. It runs on `request.raw_post`, the exact bytes received: `params` is parsed, and re-serializing it changes the bytes and breaks the signature.

### 4. Make the handler idempotent

Deliveries retry for up to 48 hours and can arrive out of order. The controller remembers each `webhook-id` and answers duplicates with `200` without processing them again. Only a first delivery is handed to `SignatureapiEventJob.perform_later`, so the request returns fast and the job records the event. The in-memory store lives in one process. In production, store the ids in your database with a unique index and run the job on a real queue adapter.

### 5. Download the signed PDF

When the envelope completes, SignatureAPI generates the deliverable: the signed PDF with its audit log. `download_signed_pdf` reads the envelope, gets its deliverable, and downloads the file from the deliverable's `url`. That URL is pre-signed and expires after 1 hour, so the app requests a fresh one on each download instead of storing it, and it sends no API key to it. Until the deliverable is generated, the route answers `409` and the page can try again a few seconds later.

## Run it

```bash
bundle install
export SIGNATUREAPI_KEY=key_test_YOUR_KEY
export SIGNATUREAPI_WEBHOOK_SECRET=whsec_...   # from the webhook endpoint in the dashboard
export APP_ORIGIN=http://localhost:3000
bin/rails server
```

Open http://localhost:3000, keep the sample name and email, and select **Start signing**.

## Expected output

```text
* Listening on http://127.0.0.1:3000
Started POST "/api/contracts" for 127.0.0.1
Started POST "/webhooks/signatureapi" for 127.0.0.1
Performed SignatureapiEventJob (Job ID: ...) from Async(default)
webhook envelope.completed for envelope eb4cf433-a8af-4161-b37b-7ef57d423e56
```

After signing, the page shows `Thanks! Envelope status: completed`.

## Run the tests

```bash
bin/rails test
```

The tests run the shared webhook [test vector](../../verify-webhooks/test-vector.json) through the verifier, then drive the app with integration tests against a local mock API served by Puma. They check the envelope payload, the signing session, the 422 path, webhook acceptance, tamper rejection, duplicate handling and the PDF download. The Active Job test adapter holds the job until `perform_enqueued_jobs` runs it. With `SIGNATUREAPI_KEY` set, live tests create a real embedded-ceremony envelope and download a signed PDF in test mode.

## Troubleshooting

- **The iframe is blank or refuses to load**: `embeddable_in` must match your page's origin exactly (scheme, host and port), and the URL needs `embedded=true`.
- **No `message` events arrive**: add `event_delivery=message` to the URL, and check that your origin filter uses `https://sign.signatureapi.com`.
- **Every webhook returns 400 `Invalid webhook signature`**: wrong secret (each endpoint has its own), or a proxy or body parser changed the body before verification.
- **`Webhook timestamp outside the tolerance window`**: your server clock is off. Sync it with NTP.
- **`ceremonyUrl` is null**: the recipient is not using `custom` authentication. With `email_link`, SignatureAPI emails the link instead.
- **`SIGNATUREAPI_KEY` is rejected at start**: the app accepts test keys only. The key starts with `key_test_`.
- **A webhook returns `received` but the event never shows in the status**: the job has not run yet, or the server restarted and cleared the in-memory store.

## Learn more

- [Embed signing in a web app](https://signatureapi.com/docs/api/guides/how-to/embed-web)
- [Ceremony events](https://signatureapi.com/docs/embedded/ceremony-events)
- [Webhooks](https://signatureapi.com/docs/api/webhooks)
- [Custom authentication](https://signatureapi.com/docs/api/guides/how-to/custom-authentication)
- [Verify webhook signatures in other languages](../../verify-webhooks)
