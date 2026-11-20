# PHP and Laravel e-signature tutorial: send, embed and track a contract with webhooks

A complete Laravel app that sends a contract for signature, lets the user sign it inside your page (embedded ceremony), and tracks the result with verified webhooks.

## The problem

Most e-signature integrations need three things working together: a server call that creates the envelope, a signing experience that keeps users in your product, and a reliable way to learn when signing is done. Getting any one wrong leaks your API key, breaks the iframe, or trusts forged webhook calls.

## What you build

A small Laravel app (two controllers and one client class, about 150 lines; the HTTP calls use Laravel's `Http` client):

| Route | Purpose |
|---|---|
| `GET /` | A page with a form and the ceremony iframe |
| `POST /api/contracts` | Creates the envelope on the server and returns the ceremony URL |
| `GET /api/contracts/{id}` | Confirms the envelope status on the server |
| `GET /api/contracts/{id}/signed.pdf` | Streams the signed PDF (the deliverable) through your server |
| `POST /webhooks/signatureapi` | Receives events, verifies the signature on the raw body, dedupes retries |

`app/Support/SignatureApi.php` holds the API client, the envelope builder and the signing session. `app/Support/WebhookVerifier.php` holds the Standard Webhooks verifier. The routes are in `routes/web.php`, which also excludes the JSON and webhook routes from CSRF protection: the browser calls them with `fetch` and the webhook sender cannot send a token.

## Prerequisites

- PHP 8.3 or newer and Composer 2.
- A SignatureAPI test API key (`key_test_...`). [Sign up](https://accounts.signatureapi.com/sign-up) for free.
- For webhooks on your machine: a webhook endpoint in the [dashboard](https://dashboard.signatureapi.com/settings/webhooks) pointing at a public tunnel, or `npx signatureapi listen` from the [SignatureAPI CLI](https://signatureapi.com/docs/cli/webhooks), which forwards test events and saves the signing secret.

## Step by step

### 1. Create the envelope on your server

The browser never sees your API key. `POST /api/contracts` calls `createSigningSession()`, which sends the envelope built by `buildContract()` with three recipient options for embedding:

```php
'recipients' => [[
    'key' => 'client', 'type' => 'signer', 'name' => $name, 'email' => $email,
    'delivery_type' => 'none',  // your app shows the result; no emails
    'ceremony' => [
        'authentication' => [['type' => 'custom', 'provider' => 'Acme Corp Portal', 'data' => ['user_id' => $userId]]],
        'embeddable_in' => [$this->appOrigin],  // the origin allowed to frame the ceremony
    ],
]],
```

`custom` authentication records that your app already signed the user in, so the ceremony URL comes back in the response at `recipients[0].ceremony.url`.

The envelope starts in `processing`, and the ceremony opens only once it is `in_progress`. `createSigningSession()` reads the envelope once a second until then and returns the ceremony URL from that read.

### 2. Embed the ceremony

``resources/views/index.blade.php`` adds the two required query parameters and loads the URL in an iframe:

```js
src.searchParams.set('embedded', 'true');
src.searchParams.set('event_delivery', 'message');
```

It accepts `message` events only when `event.origin` is `https://sign.signatureapi.com` and `event.source` is the iframe. A `ceremony.completed` message is a UI signal, so the page then asks your server for the real status.

### 3. Verify webhooks on the raw body

SignatureAPI signs each delivery with the [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks) scheme. `WebhookVerifier::verify()` computes an HMAC-SHA256 over `webhook-id.webhook-timestamp.body` with your signing secret, compares in constant time, and rejects timestamps older than 5 minutes. It runs on `$request->getContent()`, the exact bytes received: `$request->all()` and `$request->json()` are parsed, and re-encoding them changes the bytes and breaks the signature.

### 4. Make the handler idempotent

Deliveries retry for up to 48 hours and can arrive out of order. The handler remembers each `webhook-id` with `Cache::add`, which stores a key only if it is absent, and answers duplicates with `200` without processing them again. The example uses the file cache. In production, store the ids in your database with a unique index.

### 5. Download the signed PDF

When the envelope completes, SignatureAPI generates the deliverable: the signed PDF with its audit log. `downloadSignedPdf()` reads the envelope, gets its deliverable, and downloads the file from the deliverable's `url`. That URL is pre-signed and expires after 1 hour, so the app requests a fresh one on each download instead of storing it, and it sends no API key to it. Until the deliverable is generated, the route answers `409` and the page can try again a few seconds later.

## Run it

```bash
composer install
cp .env.example .env && php artisan key:generate
export SIGNATUREAPI_KEY=key_test_YOUR_KEY
export SIGNATUREAPI_WEBHOOK_SECRET=whsec_...   # from the webhook endpoint in the dashboard
export APP_ORIGIN=http://localhost:8000
php artisan serve
```

Open http://localhost:8000, keep the sample name and email, and select **Start signing**.

## Expected output

```text
   INFO  Server running on [http://127.0.0.1:8000].
```

The webhook handler writes one line per accepted event to `storage/logs/laravel.log`:

```text
local.INFO: webhook recipient.completed for envelope eb4cf433-a8af-4161-b37b-7ef57d423e56
local.INFO: webhook envelope.completed for envelope eb4cf433-a8af-4161-b37b-7ef57d423e56
```

After signing, the page shows `Thanks! Envelope status: completed`.

## Run the tests

```bash
php artisan test
```

The tests run the shared webhook [test vector](../../verify-webhooks/test-vector.json) through the verifier, then drive the app with `Http::fake` standing in for the API and check the envelope payload, the signing session, the 422 path, webhook acceptance, tamper rejection, duplicate handling and the PDF download. With `SIGNATUREAPI_KEY` set, live tests create a real embedded-ceremony envelope and download a signed PDF in test mode.

## Troubleshooting

- **The iframe is blank or refuses to load**: `embeddable_in` must match your page's origin exactly (scheme, host and port), and the URL needs `embedded=true`.
- **No `message` events arrive**: add `event_delivery=message` to the URL, and check that your origin filter uses `https://sign.signatureapi.com`.
- **Every webhook returns 400 `Invalid webhook signature`**: wrong secret (each endpoint has its own), or a proxy or body parser changed the body before verification.
- **`Webhook timestamp outside the tolerance window`**: your server clock is off. Sync it with NTP.
- **`ceremonyUrl` is null**: the recipient is not using `custom` authentication. With `email_link`, SignatureAPI emails the link instead.
- **`SIGNATUREAPI_KEY` is rejected at start**: the app accepts test keys only. The key starts with `key_test_`.
- **A browser call returns `419`**: the route is not excluded from CSRF protection. Keep the JSON and webhook routes inside the `withoutMiddleware` group in `routes/web.php`.

## Learn more

- [Embed signing in a web app](https://signatureapi.com/docs/api/guides/how-to/embed-web)
- [Ceremony events](https://signatureapi.com/docs/embedded/ceremony-events)
- [Webhooks](https://signatureapi.com/docs/api/webhooks)
- [Custom authentication](https://signatureapi.com/docs/api/guides/how-to/custom-authentication)
- [Verify webhook signatures in other languages](../../verify-webhooks)
