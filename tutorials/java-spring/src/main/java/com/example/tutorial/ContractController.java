package com.example.tutorial;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@RestController
public class ContractController {
  private static final Logger log = LoggerFactory.getLogger(ContractController.class);

  private static final class Contract {
    volatile String status;
    final List<String> events = new CopyOnWriteArrayList<>();

    Contract(String status) {
      this.status = status;
    }
  }

  private final SignatureApi api;
  private final Clock clock;
  private final ObjectMapper json = new ObjectMapper();

  // In production these live in your database.
  private final Map<String, Contract> contracts = new ConcurrentHashMap<>();
  private final Set<String> seenWebhookIds = ConcurrentHashMap.newKeySet();

  public ContractController(SignatureApi api, Clock clock) {
    this.api = api;
    this.clock = clock;
  }

  @GetMapping(value = "/", produces = MediaType.TEXT_HTML_VALUE)
  public byte[] index() throws IOException {
    return new ClassPathResource("static/index.html").getContentAsByteArray();
  }

  // Step 1: your server creates the envelope and hands the ceremony URL to the browser.
  @PostMapping("/api/contracts")
  public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, String> data) throws InterruptedException {
    String name = data.get("name");
    String email = data.get("email");
    if (name == null || name.isBlank() || email == null || email.isBlank()) {
      return ResponseEntity.unprocessableEntity().body(Map.of("error", "name and email are required"));
    }
    String userId = "usr_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8); // your signed-in user's id
    SignatureApi.SigningSession session = api.createSigningSession(name, email, userId);
    contracts.put(session.envelopeId(), new Contract("in_progress"));
    return ResponseEntity.status(201).body(Map.of("envelopeId", session.envelopeId(), "ceremonyUrl", session.ceremonyUrl()));
  }

  // Step 4: confirm the real state on the server before acting on a browser event.
  @GetMapping("/api/contracts/{id}")
  public Map<String, Object> status(@PathVariable UUID id) {
    JsonNode envelope = api.call("GET", "/v1/envelopes/" + id, null);
    Contract known = contracts.get(id.toString());
    return Map.of(
        "envelopeId", envelope.path("id").asText(),
        "status", envelope.path("status").asText(),
        "webhookEvents", known == null ? List.of() : known.events);
  }

  // Step 5: stream the signed PDF through your server, so the browser never needs your API key.
  @GetMapping("/api/contracts/{id}/signed.pdf")
  public ResponseEntity<?> signedPdf(@PathVariable UUID id) {
    try {
      byte[] pdf = api.downloadSignedPdf(id.toString());
      return ResponseEntity.ok()
          .contentType(MediaType.APPLICATION_PDF)
          .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"signed-service-agreement.pdf\"")
          .body(pdf);
    } catch (SignatureApi.NotReadyException e) {
      return ResponseEntity.status(409).body(Map.of("error", e.getMessage()));
    }
  }

  // Step 3: SignatureAPI calls this endpoint. Verify the RAW body (byte[]), never re-serialized JSON.
  @PostMapping("/webhooks/signatureapi")
  public ResponseEntity<Map<String, Object>> webhook(@RequestBody byte[] rawBody, @RequestHeader Map<String, String> requestHeaders) {
    Map<String, String> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
    headers.putAll(requestHeaders);
    try {
      WebhookVerifier.verify(api.settings().webhookSecret(), headers, rawBody, clock.instant().getEpochSecond(), 300);
    } catch (WebhookVerifier.VerificationException e) {
      return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
    }
    if (!seenWebhookIds.add(headers.get("webhook-id"))) {
      return ResponseEntity.ok(Map.of("duplicate", true));
    }
    JsonNode event = json.readTree(new String(rawBody, StandardCharsets.UTF_8));
    String type = event.path("type").asText();
    String envelopeId = event.path("data").path("envelope_id").asText("");
    Contract contract = contracts.computeIfAbsent(envelopeId, k -> new Contract("unknown"));
    contract.events.add(type);
    if (type.equals("envelope.completed")) {
      contract.status = "completed";
    }
    log.info("webhook {} for envelope {}", type, envelopeId);
    return ResponseEntity.ok(Map.of("received", true));
  }

  @ExceptionHandler(SignatureApi.ApiException.class)
  public ResponseEntity<Map<String, String>> apiError(SignatureApi.ApiException e) {
    return ResponseEntity.status(502).body(Map.of("error", e.getMessage()));
  }
}
