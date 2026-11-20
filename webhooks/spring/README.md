# Receive SignatureAPI webhooks in Spring Boot

## The problem

SignatureAPI tells your backend about events such as `envelope.completed` with a signed `POST`. Your Spring Boot endpoint must read the **raw** body, verify the signature over those exact bytes, answer with a 2xx quickly, ignore duplicate deliveries, and act on the event type. The classic bug is verifying a body that the framework already parsed and re-serialized: the bytes differ and every signature check fails.

## What you build

One endpoint, `POST /webhooks/signatureapi`, that:

1. reads the raw request body;
2. verifies `webhook-id`, `webhook-timestamp` and `webhook-signature` ([Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md#verifying-webhook-authenticity)) with a stdlib-only function copied from [`verify-webhooks`](../../verify-webhooks);
3. returns `400` for a bad signature and `200` for everything it accepted;
4. skips a `webhook-id` it has already seen;
5. switches on `envelope.completed`, `recipient.completed` and `deliverable.generated`.

## Prerequisites

- JDK 21. The Maven wrapper (`./mvnw`) downloads Maven for you.
- A webhook signing secret (`whsec_...`) from the [dashboard](https://dashboard.signatureapi.com/settings/webhooks), or from `npx signatureapi listen` (see below).

Dependencies: Spring Boot 4.0.9 (`spring-boot-starter-parent`) with `spring-boot-starter-webmvc`. The parent pins every transitive version.

## Step by step

1. **Read the raw body.** `@RequestBody byte[] rawBody` is the raw body. A DTO parameter is deserialized by Jackson first.
2. **Verify before you parse.** The verification function lives in the same folder as the app (a copy of the Java version in [`verify-webhooks`](../../verify-webhooks)). A failure returns `400` and stops.
3. **Deduplicate on `webhook-id`.** SignatureAPI retries a delivery for up to 48 hours until it gets a 2xx, and it can deliver the same event more than once. The example keeps the ids in memory, which is enough for one process. **In production** store each id in a shared place with an atomic "insert if absent": a database table with a unique index on `webhook_id`, or Redis `SET key value NX EX 86400`. Do this in the same transaction as your side effect, so a crash between the two cannot lose or repeat work.
4. **Switch on the event type.** Unknown types are acknowledged with 2xx so they are not retried. Events can arrive out of order, so make each handler safe to run in any order.
5. **Return fast.** Do the minimum in the request: verify, record the id, enqueue a job, respond. Download deliverables and update your records in a background worker.

The handler (`src/main/java/com/example/webhook/WebhookController.java`):

```java
  @PostMapping("/webhooks/signatureapi")
  public ResponseEntity<Map<String, String>> receive(
      // byte[] is the body exactly as received. Binding a DTO would parse the JSON first,
      // and re-serializing it does not give the bytes that were signed.
      @RequestBody byte[] rawBody, @RequestHeader Map<String, String> headers) {
    try {
      WebhookVerifier.verify(secret, headers, rawBody, clock.instant().getEpochSecond(), 300);
    } catch (WebhookVerifier.VerificationException e) {
      return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
    }

    // Header names are case-insensitive: Spring's Map<String,String> of headers keeps the sender's casing.
    String id =
        headers.entrySet().stream()
            .filter(e -> e.getKey().equalsIgnoreCase("webhook-id"))
            .map(Map.Entry::getValue)
            .findFirst()
            .orElseThrow();
    if (!seen.add(id)) {
      return ResponseEntity.ok(Map.of("status", "duplicate"));
    }

    // Parse only after the signature is verified. A real app would use Jackson (already on the classpath).
    String type = extract(rawBody, "type");
    switch (type) {
      case "envelope.completed" -> log.info("envelope {} completed", extract(rawBody, "envelope_id"));
      case "recipient.completed" -> log.info("recipient {} completed", extract(rawBody, "object_id"));
      case "deliverable.generated" -> log.info("deliverable {} is ready", extract(rawBody, "object_id"));
      default -> { } // Acknowledge event types you do not handle so they are not retried.
    }

    // Respond fast. Hand slow work to a queue or an @Async executor.
    return ResponseEntity.ok(Map.of("status", "ok"));
  }

  /** First string value for a key. Enough for this demo; use a JSON library for real payloads. */
  private static String extract(byte[] json, String key) {
    var m = java.util.regex.Pattern.compile("\"" + key + "\":\"([^\"]*)\"").matcher(new String(json, java.nio.charset.StandardCharsets.UTF_8));
    return m.find() ? m.group(1) : "";
  }
}
```

## Run it

```bash
cd spring
./mvnw -q -DskipTests package
SIGNATUREAPI_WEBHOOK_SECRET=whsec_xxxxxxxx ./mvnw spring-boot:run
```

The endpoint listens at `http://localhost:8080/webhooks/signatureapi`. To send it real test-mode events from your machine, in another terminal:

```bash
npx signatureapi listen --forward-to http://127.0.0.1:8080/webhooks/signatureapi
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
cd spring
./mvnw test
```

The test builds the controller with `MockMvcBuilders.standaloneSetup` and an injected `Clock` fixed at the vector's time, then performs each case with `MockMvc`. Each test posts a case from the shared [`test-vector.json`](../../verify-webhooks/test-vector.json): the valid case must return 2xx, the tampered body, the wrong-secret signature and the missing headers must return 4xx, and the same valid delivery sent twice must come back as a duplicate.

Real output:

```text
[INFO] Tests run: 5, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.397 s -- in com.example.webhook.WebhookControllerTest
[INFO] Tests run: 5, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

Tested in the official image `eclipse-temurin@sha256:db5cc6341a1d7bc40cdb51e1f0d9824f3bb2cc8107d29da421dc4df7d11f05f1`, with the repository root mounted at `/repo` (the test reads `../../verify-webhooks/test-vector.json`).

## Troubleshooting

- **Every real delivery returns 400**: you are verifying parsed JSON, or the wrong secret. Test-mode and live-mode endpoints have different signing secrets. Check the raw-body step above.
- **400 "Timestamp outside the tolerance window"**: the server clock is more than 5 minutes off. Fix NTP.
- **SignatureAPI shows failed deliveries and retries**: your endpoint returned a non-2xx or timed out. Check the logs, and keep the handler fast.
- **`Content type not supported`**: the controller declares a DTO. Keep `byte[]`.
- **Header lookup fails**: Spring keeps the sender's header casing in a `Map<String, String>`. The controller matches `webhook-id` case-insensitively.
- **A proxy rewrites the body**: gzip, charset conversion or a body-parsing gateway breaks the signature. Let the raw bytes through.

## Learn more

- [Webhooks](https://signatureapi.com/docs/api/webhooks)
- [Set up webhooks](https://signatureapi.com/docs/api/guides/how-to/set-up-webhooks)
- [Event object](https://signatureapi.com/docs/api/resources/events/object)
- [Envelope events](https://signatureapi.com/docs/api/resources/events/envelope-events)
- [Deliverable events](https://signatureapi.com/docs/api/resources/events/deliverable-events)
- [Test webhooks with the CLI](https://signatureapi.com/docs/cli/webhooks)
