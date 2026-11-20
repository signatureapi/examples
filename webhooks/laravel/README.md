# Receive SignatureAPI webhooks in Laravel

## The problem

SignatureAPI tells your backend about events such as `envelope.completed` with a signed `POST`. Your Laravel endpoint must read the **raw** body, verify the signature over those exact bytes, answer with a 2xx quickly, ignore duplicate deliveries, and act on the event type. The classic bug is verifying a body that the framework already parsed and re-serialized: the bytes differ and every signature check fails.

## What you build

One endpoint, `POST /webhooks/signatureapi`, that:

1. reads the raw request body;
2. verifies `webhook-id`, `webhook-timestamp` and `webhook-signature` ([Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md#verifying-webhook-authenticity)) with a stdlib-only function copied from [`verify-webhooks`](../../verify-webhooks);
3. returns `400` for a bad signature and `200` for everything it accepted;
4. skips a `webhook-id` it has already seen;
5. switches on `envelope.completed`, `recipient.completed` and `deliverable.generated`.

## Prerequisites

- PHP 8.3 or newer and Composer 2.
- A webhook signing secret (`whsec_...`) from the [dashboard](https://dashboard.signatureapi.com/settings/webhooks), or from `npx signatureapi listen` (see below).

Dependencies: `laravel/framework` 13.43.0 and the rest of the tree, exact-pinned in `composer.json` and `composer.lock` (Composer 2.8.12).

## Step by step

1. **Read the raw body.** `$request->getContent()` is the raw body. `$request->all()` and `$request->json()` are parsed.
2. **Verify before you parse.** The verification function lives in the same folder as the app (a copy of the PHP version in [`verify-webhooks`](../../verify-webhooks)). A failure returns `400` and stops.
3. **Deduplicate on `webhook-id`.** SignatureAPI retries a delivery for up to 48 hours until it gets a 2xx, and it can deliver the same event more than once. The example keeps the ids in memory, which is enough for one process. **In production** store each id in a shared place with an atomic "insert if absent": a database table with a unique index on `webhook_id`, or Redis `SET key value NX EX 86400`. Do this in the same transaction as your side effect, so a crash between the two cannot lose or repeat work.
4. **Switch on the event type.** Unknown types are acknowledged with 2xx so they are not retried. Events can arrive out of order, so make each handler safe to run in any order.
5. **Return fast.** Do the minimum in the request: verify, record the id, enqueue a job, respond. Download deliverables and update your records in a background worker.

The handler (`app/Http/Controllers/WebhookController.php`):

```php
    public function receive(Request $request): JsonResponse
    {
        // getContent() is the body exactly as received. $request->all() or json() would be parsed,
        // and re-encoding them does not give the bytes that were signed.
        $rawBody = $request->getContent();

        try {
            WebhookVerifier::verify(
                (string) config('services.signatureapi.webhook_secret'),
                [
                    'webhook-id' => $request->header('webhook-id'),
                    'webhook-timestamp' => $request->header('webhook-timestamp'),
                    'webhook-signature' => $request->header('webhook-signature'),
                ],
                $rawBody,
                Carbon::now()->getTimestamp(),
            );
        } catch (WebhookVerificationException $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        }

        // Cache::add stores the key only if it is absent, atomically. With the Redis or database cache
        // driver this dedupes across servers; the array driver used in tests lives for one process.
        if (!Cache::add('signatureapi-webhook:' . $request->header('webhook-id'), true, now()->addDay())) {
            return response()->json(['status' => 'duplicate']);
        }

        $event = json_decode($rawBody, true, 512, JSON_THROW_ON_ERROR);
        switch ($event['type']) {
            case 'envelope.completed':
                Log::info("envelope {$event['data']['envelope_id']} completed");
                break;
            case 'recipient.completed':
                Log::info("recipient {$event['data']['object_id']} completed");
                break;
            case 'deliverable.generated':
                Log::info("deliverable {$event['data']['object_id']} is ready");
                break;
            default:
                break; // Acknowledge event types you do not handle so they are not retried.
        }

        // Respond fast. Hand slow work to a queued job (dispatch(new ProcessEnvelope(...))).
        return response()->json(['status' => 'ok']);
    }
}
```

## Run it

```bash
cd laravel
composer install && cp .env.example .env && php artisan key:generate
SIGNATUREAPI_WEBHOOK_SECRET=whsec_xxxxxxxx php artisan serve --port=8000
```

The endpoint listens at `http://localhost:8000/webhooks/signatureapi`. To send it real test-mode events from your machine, in another terminal:

```bash
npx signatureapi listen --forward-to http://127.0.0.1:8000/webhooks/signatureapi
npx signatureapi trigger envelope.completed
```

`listen` saves the endpoint's signing secret as `SIGNATUREAPI_WEBHOOK_SECRET` in a `.env` file. Export it before you start the app.

## Expected output

With the app running, a delivery that passes returns `200` and logs one line:

```text
envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 completed
```

A tampered body returns `400` with `{"error":"No matching signature"}`. Post the same `webhook-id` twice and the second answer is `{"status":"duplicate"}`.

## Run the tests

```bash
cd laravel
php artisan test
```

The test calls the route with `$this->call()` and a string body (not `postJson()`, which would encode an array), and freezes time with `Carbon::setTestNow`. `phpunit.xml` already uses the `array` cache driver. Each test posts a case from the shared [`test-vector.json`](../../verify-webhooks/test-vector.json): the valid case must return 2xx, the tampered body, the wrong-secret signature and the missing headers must return 4xx, and the same valid delivery sent twice must come back as a duplicate.

Real output:

```text
   PASS  Tests\Feature\WebhookTest
  ✓ valid delivery returns 2xx
  ✓ a repeated webhook id is acknowledged as a duplicate
  ✓ tampered body returns 4xx
  ✓ wrong secret returns 4xx
  ✓ missing headers return 4xx

  Tests:    5 passed (7 assertions)
```

Tested in the official image `php@sha256:628102249d93494233b54490b785f12db9cd60f4dc89416dfca15973f2125f10`, with the repository root mounted at `/repo` (the test reads `../../verify-webhooks/test-vector.json`).

## Troubleshooting

- **Every real delivery returns 400**: you are verifying parsed JSON, or the wrong secret. Test-mode and live-mode endpoints have different signing secrets. Check the raw-body step above.
- **400 "Timestamp outside the tolerance window"**: the server clock is more than 5 minutes off. Fix NTP.
- **SignatureAPI shows failed deliveries and retries**: your endpoint returned a non-2xx or timed out. Check the logs, and keep the handler fast.
- **`419 Page Expired`**: the CSRF middleware ran. `routes/web.php` removes `PreventRequestForgery` from this route.
- **Duplicates are not detected across requests**: the default `database` cache driver needs its migration, and the `array` driver forgets between requests. Use `redis`, `memcached` or `database` in production.
- **A proxy rewrites the body**: gzip, charset conversion or a body-parsing gateway breaks the signature. Let the raw bytes through.

## Learn more

- [Webhooks](https://signatureapi.com/docs/api/webhooks)
- [Set up webhooks](https://signatureapi.com/docs/api/guides/how-to/set-up-webhooks)
- [Event object](https://signatureapi.com/docs/api/resources/events/object)
- [Envelope events](https://signatureapi.com/docs/api/resources/events/envelope-events)
- [Deliverable events](https://signatureapi.com/docs/api/resources/events/deliverable-events)
- [Test webhooks with the CLI](https://signatureapi.com/docs/cli/webhooks)
