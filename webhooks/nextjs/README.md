# Receive SignatureAPI webhooks in Next.js

## The problem

SignatureAPI tells your backend about events such as `envelope.completed` with a signed `POST`. Your Next.js endpoint must read the **raw** body, verify the signature over those exact bytes, answer with a 2xx quickly, ignore duplicate deliveries, and act on the event type. The classic bug is verifying a body that the framework already parsed and re-serialized: the bytes differ and every signature check fails.

## What you build

One endpoint, `POST /api/webhooks/signatureapi`, that:

1. reads the raw request body;
2. verifies `webhook-id`, `webhook-timestamp` and `webhook-signature` ([Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md#verifying-webhook-authenticity)) with a stdlib-only function copied from [`verify-webhooks`](../../verify-webhooks);
3. returns `400` for a bad signature and `200` for everything it accepted;
4. skips a `webhook-id` it has already seen;
5. switches on `envelope.completed`, `recipient.completed` and `deliverable.generated`.

## Prerequisites

- Node.js 20 or newer.
- A webhook signing secret (`whsec_...`) from the [dashboard](https://dashboard.signatureapi.com/settings/webhooks), or from `npx signatureapi listen` (see below).

Dependencies: `next` 16.4.6, `react` and `react-dom` 19.1.1, exact-pinned in `package.json` and `package-lock.json`.

## Step by step

1. **Read the raw body.** `await request.text()` in the route handler returns the body as received. `request.json()` parses first.
2. **Verify before you parse.** The verification function lives in the same folder as the app (a copy of the Node.js version in [`verify-webhooks`](../../verify-webhooks)). A failure returns `400` and stops.
3. **Deduplicate on `webhook-id`.** SignatureAPI retries a delivery for up to 48 hours until it gets a 2xx, and it can deliver the same event more than once. The example keeps the ids in memory, which is enough for one process. **In production** store each id in a shared place with an atomic "insert if absent": a database table with a unique index on `webhook_id`, or Redis `SET key value NX EX 86400`. Do this in the same transaction as your side effect, so a crash between the two cannot lose or repeat work.
4. **Switch on the event type.** Unknown types are acknowledged with 2xx so they are not retried. Events can arrive out of order, so make each handler safe to run in any order.
5. **Return fast.** Do the minimum in the request: verify, record the id, enqueue a job, respond. Download deliverables and update your records in a background worker.

The handler (`lib/webhook-handler.mjs`):

```js
  return async function POST(request) {
    // request.text() returns the body exactly as received. request.json() would parse it first,
    // and re-serializing the result does not give the bytes that were signed.
    const rawBody = await request.text();
    const headers = Object.fromEntries(request.headers);

    try {
      verifyWebhook(secret ?? process.env.SIGNATUREAPI_WEBHOOK_SECRET, headers, rawBody, { now: now() });
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const id = headers["webhook-id"];
    if (seen.has(id)) return Response.json({ status: "duplicate" });
    seen.add(id);

    const event = JSON.parse(rawBody);
    switch (event.type) {
      case "envelope.completed":
        console.log(`envelope ${event.data.envelope_id} completed`);
        break;
      case "recipient.completed":
        console.log(`recipient ${event.data.object_id} completed`);
        break;
      case "deliverable.generated":
        console.log(`deliverable ${event.data.object_id} is ready`);
        break;
      default:
        break;
    }

```

## Run it

```bash
cd nextjs
npm ci
SIGNATUREAPI_WEBHOOK_SECRET=whsec_xxxxxxxx npm run dev
```

The endpoint listens at `http://localhost:3000/api/webhooks/signatureapi`. To send it real test-mode events from your machine, in another terminal:

```bash
npx signatureapi listen --forward-to http://127.0.0.1:3000/api/webhooks/signatureapi
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
cd nextjs
npm ci && npm test
```

A route handler is a plain `(Request) => Response` function (App Router), so the test calls it directly with a `Request` and a fixed clock. `npm run build` also compiles the route and lists it as `ƒ /api/webhooks/signatureapi` (dynamic). Each test posts a case from the shared [`test-vector.json`](../../verify-webhooks/test-vector.json): the valid case must return 2xx, the tampered body, the wrong-secret signature and the missing headers must return 4xx, and the same valid delivery sent twice must come back as a duplicate.

Real output:

```text
✔ valid delivery returns 2xx (12.305477ms)
✔ a repeated webhook-id is acknowledged as a duplicate (0.913826ms)
✔ tampered body returns 4xx (0.56562ms)
✔ wrong secret returns 4xx (0.51662ms)
✔ missing headers return 4xx (0.270331ms)
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

## Troubleshooting

- **Every real delivery returns 400**: you are verifying parsed JSON, or the wrong secret. Test-mode and live-mode endpoints have different signing secrets. Check the raw-body step above.
- **400 "Timestamp outside the tolerance window"**: the server clock is more than 5 minutes off. Fix NTP.
- **SignatureAPI shows failed deliveries and retries**: your endpoint returned a non-2xx or timed out. Check the logs, and keep the handler fast.
- **404 on the endpoint**: the App Router path is `app/api/webhooks/signatureapi/route.js`, so the URL is `/api/webhooks/signatureapi`.
- **Route is cached or static**: `export const dynamic = "force-dynamic"` is set in `route.js`.
- **A proxy rewrites the body**: gzip, charset conversion or a body-parsing gateway breaks the signature. Let the raw bytes through.

## Learn more

- [Webhooks](https://signatureapi.com/docs/api/webhooks)
- [Set up webhooks](https://signatureapi.com/docs/api/guides/how-to/set-up-webhooks)
- [Event object](https://signatureapi.com/docs/api/resources/events/object)
- [Envelope events](https://signatureapi.com/docs/api/resources/events/envelope-events)
- [Deliverable events](https://signatureapi.com/docs/api/resources/events/deliverable-events)
- [Test webhooks with the CLI](https://signatureapi.com/docs/cli/webhooks)
