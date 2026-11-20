# Receive SignatureAPI webhooks in ASP.NET Core

## The problem

SignatureAPI tells your backend about events such as `envelope.completed` with a signed `POST`. Your ASP.NET Core endpoint must read the **raw** body, verify the signature over those exact bytes, answer with a 2xx quickly, ignore duplicate deliveries, and act on the event type. The classic bug is verifying a body that the framework already parsed and re-serialized: the bytes differ and every signature check fails.

## What you build

One endpoint, `POST /webhooks/signatureapi`, that:

1. reads the raw request body;
2. verifies `webhook-id`, `webhook-timestamp` and `webhook-signature` ([Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md#verifying-webhook-authenticity)) with a stdlib-only function copied from [`verify-webhooks`](../../verify-webhooks);
3. returns `400` for a bad signature and `200` for everything it accepted;
4. skips a `webhook-id` it has already seen;
5. switches on `envelope.completed`, `recipient.completed` and `deliverable.generated`.

## Prerequisites

- .NET SDK 8.0 or newer.
- A webhook signing secret (`whsec_...`) from the [dashboard](https://dashboard.signatureapi.com/settings/webhooks), or from `npx signatureapi listen` (see below).

Dependencies: `Microsoft.AspNetCore.Mvc.Testing` 8.0.11, `Microsoft.NET.Test.Sdk` 17.11.1, `xunit` 2.9.2, `xunit.runner.visualstudio` 2.8.2, with `packages.lock.json` for both projects.

## Step by step

1. **Read the raw body.** Copy `request.Body` to a `MemoryStream` and use the bytes. A parameter bound to a model is deserialized by ASP.NET first.
2. **Verify before you parse.** The verification function lives in the same folder as the app (a copy of the C# version in [`verify-webhooks`](../../verify-webhooks)). A failure returns `400` and stops.
3. **Deduplicate on `webhook-id`.** SignatureAPI retries a delivery for up to 48 hours until it gets a 2xx, and it can deliver the same event more than once. The example keeps the ids in memory, which is enough for one process. **In production** store each id in a shared place with an atomic "insert if absent": a database table with a unique index on `webhook_id`, or Redis `SET key value NX EX 86400`. Do this in the same transaction as your side effect, so a crash between the two cannot lose or repeat work.
4. **Switch on the event type.** Unknown types are acknowledged with 2xx so they are not retried. Events can arrive out of order, so make each handler safe to run in any order.
5. **Return fast.** Do the minimum in the request: verify, record the id, enqueue a job, respond. Download deliverables and update your records in a background worker.

The handler (`WebhookApi/Program.cs`):

```csharp
app.MapPost("/webhooks/signatureapi", async (HttpRequest request, TimeProvider clock, SeenWebhooks seen, IConfiguration config, ILogger<Program> log) =>
{
    // Read the body as bytes, exactly as received. Binding a model parameter would deserialize it first,
    // and re-serializing the result does not give the bytes that were signed.
    using var buffer = new MemoryStream();
    await request.Body.CopyToAsync(buffer);
    var rawBody = buffer.ToArray();

    var headers = request.Headers.ToDictionary(h => h.Key, h => h.Value.ToString());
    try
    {
        WebhookVerifier.Verify(config["SIGNATUREAPI_WEBHOOK_SECRET"] ?? "", headers, rawBody, clock.GetUtcNow().ToUnixTimeSeconds());
    }
    catch (WebhookVerifier.VerificationException e)
    {
        return Results.Json(new { error = e.Message }, statusCode: StatusCodes.Status400BadRequest);
    }

    if (!seen.TryAdd(headers["webhook-id"]))
        return Results.Json(new { status = "duplicate" });

    using var doc = JsonDocument.Parse(rawBody);
    var data = doc.RootElement.GetProperty("data");
    switch (doc.RootElement.GetProperty("type").GetString())
    {
        case "envelope.completed":
            log.LogInformation("envelope {Id} completed", data.GetProperty("envelope_id").GetString());
            break;
        case "recipient.completed":
            log.LogInformation("recipient {Id} completed", data.GetProperty("object_id").GetString());
            break;
        case "deliverable.generated":
            log.LogInformation("deliverable {Id} is ready", data.GetProperty("object_id").GetString());
            break;
        default:
            break; // Acknowledge event types you do not handle so they are not retried.
    }

    // Respond fast. Hand slow work to a queue or a hosted background service.
    return Results.Json(new { status = "ok" });
});

app.Run();

```

## Run it

```bash
cd aspnet
dotnet restore
SIGNATUREAPI_WEBHOOK_SECRET=whsec_xxxxxxxx dotnet run --project WebhookApi --urls http://localhost:5000
```

The endpoint listens at `http://localhost:5000/webhooks/signatureapi`. To send it real test-mode events from your machine, in another terminal:

```bash
npx signatureapi listen --forward-to http://127.0.0.1:5000/webhooks/signatureapi
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
cd aspnet
dotnet test
```

The tests use `WebApplicationFactory<Program>` with an in-memory secret and a fixed `TimeProvider` registered in dependency injection. Each test posts a case from the shared [`test-vector.json`](../../verify-webhooks/test-vector.json): the valid case must return 2xx, the tampered body, the wrong-secret signature and the missing headers must return 4xx, and the same valid delivery sent twice must come back as a duplicate.

Real output:

```text
Passed!  - Failed:     0, Passed:     5, Skipped:     0, Total:     5, Duration: 75 ms - WebhookApi.Tests.dll (net8.0)
```

Tested in the official image `mcr.microsoft.com/dotnet/sdk@sha256:1b955f179b02df4f0eb5fadedaa898cbe44d620a64aab52eec72c8e91d1355b5`, with the repository root mounted at `/repo` (the test reads `../../verify-webhooks/test-vector.json`).

## Troubleshooting

- **Every real delivery returns 400**: you are verifying parsed JSON, or the wrong secret. Test-mode and live-mode endpoints have different signing secrets. Check the raw-body step above.
- **400 "Timestamp outside the tolerance window"**: the server clock is more than 5 minutes off. Fix NTP.
- **SignatureAPI shows failed deliveries and retries**: your endpoint returned a non-2xx or timed out. Check the logs, and keep the handler fast.
- **The signature never matches in tests**: send the body with `StringContent`, not `JsonContent.Create(object)`, which re-serializes it.
- **A proxy rewrites the body**: gzip, charset conversion or a body-parsing gateway breaks the signature. Let the raw bytes through.

## Learn more

- [Webhooks](https://signatureapi.com/docs/api/webhooks)
- [Set up webhooks](https://signatureapi.com/docs/api/guides/how-to/set-up-webhooks)
- [Event object](https://signatureapi.com/docs/api/resources/events/object)
- [Envelope events](https://signatureapi.com/docs/api/resources/events/envelope-events)
- [Deliverable events](https://signatureapi.com/docs/api/resources/events/deliverable-events)
- [Test webhooks with the CLI](https://signatureapi.com/docs/cli/webhooks)
