# Receive SignatureAPI webhooks in Django

## The problem

SignatureAPI tells your backend about events such as `envelope.completed` with a signed `POST`. Your Django endpoint must read the **raw** body, verify the signature over those exact bytes, answer with a 2xx quickly, ignore duplicate deliveries, and act on the event type. The classic bug is verifying a body that the framework already parsed and re-serialized: the bytes differ and every signature check fails.

## What you build

One endpoint, `POST /webhooks/signatureapi`, that:

1. reads the raw request body;
2. verifies `webhook-id`, `webhook-timestamp` and `webhook-signature` ([Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md#verifying-webhook-authenticity)) with a stdlib-only function copied from [`verify-webhooks`](../../verify-webhooks);
3. returns `400` for a bad signature and `200` for everything it accepted;
4. skips a `webhook-id` it has already seen;
5. switches on `envelope.completed`, `recipient.completed` and `deliverable.generated`.

## Prerequisites

- Python 3.10 or newer.
- A webhook signing secret (`whsec_...`) from the [dashboard](https://dashboard.signatureapi.com/settings/webhooks), or from `npx signatureapi listen` (see below).

Dependencies: `Django` 5.2.18 and its three dependencies, pinned in `requirements.txt`.

## Step by step

1. **Read the raw body.** `request.body` is the raw bytes. `request.POST` and `json.dumps(json.loads(...))` are not.
2. **Verify before you parse.** The verification function lives in the same folder as the app (a copy of the Python version in [`verify-webhooks`](../../verify-webhooks)). A failure returns `400` and stops.
3. **Deduplicate on `webhook-id`.** SignatureAPI retries a delivery for up to 48 hours until it gets a 2xx, and it can deliver the same event more than once. The example keeps the ids in memory, which is enough for one process. **In production** store each id in a shared place with an atomic "insert if absent": a database table with a unique index on `webhook_id`, or Redis `SET key value NX EX 86400`. Do this in the same transaction as your side effect, so a crash between the two cannot lose or repeat work.
4. **Switch on the event type.** Unknown types are acknowledged with 2xx so they are not retried. Events can arrive out of order, so make each handler safe to run in any order.
5. **Return fast.** Do the minimum in the request: verify, record the id, enqueue a job, respond. Download deliverables and update your records in a background worker.

The handler (`views.py`):

```python
@csrf_exempt  # The sender cannot present a CSRF token. The signature is the authentication.
@require_POST
def signatureapi_webhook(request):
    # request.body is the raw bytes. Never verify json.dumps(json.loads(...)): the bytes differ.
    raw_body = request.body
    try:
        verify_webhook(settings.SIGNATUREAPI_WEBHOOK_SECRET, request.headers, raw_body, now=now())
    except WebhookVerificationError as error:
        return JsonResponse({"error": str(error)}, status=400)

    webhook_id = request.headers["webhook-id"]
    if webhook_id in seen_ids:
        return JsonResponse({"status": "duplicate"})
    seen_ids.add(webhook_id)

    event = json.loads(raw_body)
    match event["type"]:
        case "envelope.completed":
            print(f"envelope {event['data']['envelope_id']} completed")
        case "recipient.completed":
            print(f"recipient {event['data']['object_id']} completed")
        case "deliverable.generated":
            print(f"deliverable {event['data']['object_id']} is ready")
        case _:
            pass  # Acknowledge event types you do not handle so they are not retried.

    # Respond fast. Hand slow work to a task queue.
    return JsonResponse({"status": "ok"})
```

## Run it

```bash
cd django
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
SIGNATUREAPI_WEBHOOK_SECRET=whsec_xxxxxxxx .venv/bin/python manage.py runserver 8000
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
cd django
.venv/bin/python manage.py test -v 2
```

The test uses Django's test `Client` and patches the `now()` function in `views.py` to the vector's time. `manage.py` sets `DJANGO_SETTINGS_MODULE=settings` itself. Each test posts a case from the shared [`test-vector.json`](../../verify-webhooks/test-vector.json): the valid case must return 2xx, the tampered body, the wrong-secret signature and the missing headers must return 4xx, and the same valid delivery sent twice must come back as a duplicate.

Real output:

```text
test_missing_headers_return_4xx (test_webhook.WebhookTests) ... ok
test_repeated_webhook_id_is_a_duplicate (test_webhook.WebhookTests) ... ok
test_tampered_body_returns_4xx (test_webhook.WebhookTests) ... ok
test_valid_delivery_returns_2xx (test_webhook.WebhookTests) ... ok
test_wrong_secret_returns_4xx (test_webhook.WebhookTests) ... ok

Ran 5 tests in 0.023s

OK
```

## Troubleshooting

- **Every real delivery returns 400**: you are verifying parsed JSON, or the wrong secret. Test-mode and live-mode endpoints have different signing secrets. Check the raw-body step above.
- **400 "Timestamp outside the tolerance window"**: the server clock is more than 5 minutes off. Fix NTP.
- **SignatureAPI shows failed deliveries and retries**: your endpoint returned a non-2xx or timed out. Check the logs, and keep the handler fast.
- **`403 CSRF verification failed`**: the view lost `@csrf_exempt`, or you added `CsrfViewMiddleware` globally without the exemption.
- **`DisallowedHost`**: add your host to `ALLOWED_HOSTS` in `settings.py`.
- **A proxy rewrites the body**: gzip, charset conversion or a body-parsing gateway breaks the signature. Let the raw bytes through.

## Learn more

- [Webhooks](https://signatureapi.com/docs/api/webhooks)
- [Set up webhooks](https://signatureapi.com/docs/api/guides/how-to/set-up-webhooks)
- [Event object](https://signatureapi.com/docs/api/resources/events/object)
- [Envelope events](https://signatureapi.com/docs/api/resources/events/envelope-events)
- [Deliverable events](https://signatureapi.com/docs/api/resources/events/deliverable-events)
- [Test webhooks with the CLI](https://signatureapi.com/docs/cli/webhooks)
