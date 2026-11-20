package com.example.webhook;

import java.time.Clock;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class WebhookController {
  private static final Logger log = LoggerFactory.getLogger(WebhookController.class);

  private final String secret;
  private final Clock clock;

  // Production: replace with a shared store (see README). A set only dedupes within one process.
  private final Set<String> seen = ConcurrentHashMap.newKeySet();

  public WebhookController(@Value("${SIGNATUREAPI_WEBHOOK_SECRET:}") String secret, Clock clock) {
    this.secret = secret;
    this.clock = clock;
  }

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
