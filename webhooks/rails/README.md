# Receive SignatureAPI webhooks in Rails

## The problem

SignatureAPI tells your backend about events such as `envelope.completed` with a signed `POST`. Your Rails endpoint must read the **raw** body, verify the signature over those exact bytes, answer with a 2xx quickly, ignore duplicate deliveries, and act on the event type. The classic bug is verifying a body that the framework already parsed and re-serialized: the bytes differ and every signature check fails.

## What you build

One endpoint, `POST /webhooks/signatureapi`, that:

1. reads the raw request body;
2. verifies `webhook-id`, `webhook-timestamp` and `webhook-signature` ([Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md#verifying-webhook-authenticity)) with a stdlib-only function copied from [`verify-webhooks`](../../verify-webhooks);
3. returns `400` for a bad signature and `200` for everything it accepted;
4. skips a `webhook-id` it has already seen;
5. switches on `envelope.completed`, `recipient.completed` and `deliverable.generated`.

## Prerequisites

- Ruby 3.3 and Bundler. A C compiler to build native gems (`build-essential` on Debian).
- A webhook signing secret (`whsec_...`) from the [dashboard](https://dashboard.signatureapi.com/settings/webhooks), or from `npx signatureapi listen` (see below).

Dependencies: `rails` 8.1.4.1, `puma` 8.1.2, `debug` 1.11.1, exact-pinned in `Gemfile` and `Gemfile.lock`.

## Step by step

1. **Read the raw body.** `request.raw_post` is the raw body. `params` and `request.parameters` are parsed.
2. **Verify before you parse.** The verification function lives in the same folder as the app (a copy of the Ruby version in [`verify-webhooks`](../../verify-webhooks)). A failure returns `400` and stops.
3. **Deduplicate on `webhook-id`.** SignatureAPI retries a delivery for up to 48 hours until it gets a 2xx, and it can deliver the same event more than once. The example keeps the ids in memory, which is enough for one process. **In production** store each id in a shared place with an atomic "insert if absent": a database table with a unique index on `webhook_id`, or Redis `SET key value NX EX 86400`. Do this in the same transaction as your side effect, so a crash between the two cannot lose or repeat work.
4. **Switch on the event type.** Unknown types are acknowledged with 2xx so they are not retried. Events can arrive out of order, so make each handler safe to run in any order.
5. **Return fast.** Do the minimum in the request: verify, record the id, enqueue a job, respond. Download deliverables and update your records in a background worker.

The handler (`app/controllers/webhooks_controller.rb`):

```ruby
  def create
    # raw_post is the body exactly as received. request.parameters (or params.to_json) would be
    # parsed and re-serialized, and those bytes are not the ones that were signed.
    raw_body = request.raw_post
    headers = %w[webhook-id webhook-timestamp webhook-signature].to_h { |name| [name, request.headers[name]] }

    begin
      SignatureApi.verify_webhook(Rails.configuration.x.signatureapi_webhook_secret, headers, raw_body)
    rescue SignatureApi::WebhookVerificationError => e
      return render json: { error: e.message }, status: :bad_request
    end

    duplicate = SEEN_LOCK.synchronize { !SEEN.add?(headers["webhook-id"]) }
    return render json: { status: "duplicate" } if duplicate

    event = JSON.parse(raw_body)
    case event["type"]
    when "envelope.completed"
      Rails.logger.info("envelope #{event.dig("data", "envelope_id")} completed")
    when "recipient.completed"
      Rails.logger.info("recipient #{event.dig("data", "object_id")} completed")
    when "deliverable.generated"
      Rails.logger.info("deliverable #{event.dig("data", "object_id")} is ready")
    end # Other event types are acknowledged so they are not retried.

    # Respond fast. Hand slow work to a job queue such as Active Job.
    render json: { status: "ok" }
  end
end
```

## Run it

```bash
cd rails
bundle install
SIGNATUREAPI_WEBHOOK_SECRET=whsec_xxxxxxxx bin/rails server -p 3000
```

The endpoint listens at `http://localhost:3000/webhooks/signatureapi`. To send it real test-mode events from your machine, in another terminal:

```bash
npx signatureapi listen --forward-to http://127.0.0.1:3000/webhooks/signatureapi
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
cd rails
bin/rails test
```

The test is an `ActionDispatch::IntegrationTest`. It freezes time with `travel_to` and sends each case with a String body, which Rails passes through unchanged. The app is API-only, so there is no CSRF check to turn off. Each test posts a case from the shared [`test-vector.json`](../../verify-webhooks/test-vector.json): the valid case must return 2xx, the tampered body, the wrong-secret signature and the missing headers must return 4xx, and the same valid delivery sent twice must come back as a duplicate.

Real output:

```text
Running 5 tests in a single process (parallelization threshold is 50)
Run options: --seed 15158

# Running:

.....

Finished in 0.200457s, 24.9430 runs/s, 29.9316 assertions/s.
5 runs, 6 assertions, 0 failures, 0 errors, 0 skips
```

Tested in the official image `ruby@sha256:db3ad6dd68a886d51a187fb9bf486052f2976cdbe3b750169c25092aba1297fa`, with the repository root mounted at `/repo` (the test reads `../../verify-webhooks/test-vector.json`).

## Troubleshooting

- **Every real delivery returns 400**: you are verifying parsed JSON, or the wrong secret. Test-mode and live-mode endpoints have different signing secrets. Check the raw-body step above.
- **400 "Timestamp outside the tolerance window"**: the server clock is more than 5 minutes off. Fix NTP.
- **SignatureAPI shows failed deliveries and retries**: your endpoint returned a non-2xx or timed out. Check the logs, and keep the handler fast.
- **`Blocked hosts` in development**: add the tunnel host to `config.hosts` in `config/environments/development.rb`.
- **Duplicates slip through behind several Puma workers**: the `Set` is per process. Use `Rails.cache` backed by Redis or a unique database index (see the production note).
- **A proxy rewrites the body**: gzip, charset conversion or a body-parsing gateway breaks the signature. Let the raw bytes through.

## Learn more

- [Webhooks](https://signatureapi.com/docs/api/webhooks)
- [Set up webhooks](https://signatureapi.com/docs/api/guides/how-to/set-up-webhooks)
- [Event object](https://signatureapi.com/docs/api/resources/events/object)
- [Envelope events](https://signatureapi.com/docs/api/resources/events/envelope-events)
- [Deliverable events](https://signatureapi.com/docs/api/resources/events/deliverable-events)
- [Test webhooks with the CLI](https://signatureapi.com/docs/cli/webhooks)
