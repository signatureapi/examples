package com.example.tutorial;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** SignatureAPI client and envelope builder for the Spring tutorial. JDK HTTP client only. */
@Component
public class SignatureApi {
  public record Settings(String apiKey, String baseUrl, String webhookSecret, String appOrigin) {
    public static Settings from(Function<String, String> env) {
      String key = env.apply("SIGNATUREAPI_KEY");
      if (key == null || !key.startsWith("key_test_")) {
        throw new IllegalStateException("Set SIGNATUREAPI_KEY to a test API key (it starts with key_test_).");
      }
      String base = orDefault(env.apply("SIGNATUREAPI_BASE_URL"), "https://api.signatureapi.com");
      return new Settings(
          key,
          base.replaceAll("/+$", ""),
          orDefault(env.apply("SIGNATUREAPI_WEBHOOK_SECRET"), ""),
          orDefault(env.apply("APP_ORIGIN"), "http://localhost:8080"));
    }

    private static String orDefault(String value, String fallback) {
      return value == null || value.isEmpty() ? fallback : value;
    }
  }

  public static class ApiException extends RuntimeException {
    public ApiException(String message) {
      super(message);
    }
  }

  /** The deliverable is not ready yet. The app answers 409 and the user tries again. */
  public static class NotReadyException extends RuntimeException {
    public NotReadyException(String message) {
      super(message);
    }
  }

  private final Settings settings;
  private final HttpClient http =
      HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).followRedirects(HttpClient.Redirect.NORMAL).build();
  private final ObjectMapper json = new ObjectMapper();

  public SignatureApi(Settings settings) {
    this.settings = settings;
  }

  public Settings settings() {
    return settings;
  }

  /** Calls the API with the X-API-Key header and returns the parsed JSON response. */
  public JsonNode call(String method, String path, Object body) {
    HttpRequest.Builder request =
        HttpRequest.newBuilder(URI.create(settings.baseUrl() + path))
            .timeout(Duration.ofSeconds(60))
            .header("X-API-Key", settings.apiKey())
            .header("Accept", "application/json");
    if (body == null) {
      request.method(method, HttpRequest.BodyPublishers.noBody());
    } else {
      request.header("Content-Type", "application/json");
      request.method(method, HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
    }
    HttpResponse<String> response = send(request.build(), HttpResponse.BodyHandlers.ofString());
    JsonNode parsed = response.body().isBlank() ? json.nullNode() : json.readTree(response.body());
    if (response.statusCode() >= 400) {
      String detail = parsed.path("detail").asText(parsed.path("title").asText(""));
      throw new ApiException("SignatureAPI returned " + response.statusCode() + (detail.isEmpty() ? "" : ": " + detail));
    }
    return parsed;
  }

  private <T> HttpResponse<T> send(HttpRequest request, HttpResponse.BodyHandler<T> handler) {
    try {
      return http.send(request, handler);
    } catch (IOException e) {
      throw new ApiException("Could not reach SignatureAPI");
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new ApiException("Interrupted");
    }
  }

  /** Envelope for an embedded ceremony: custom authentication, embeddable_in, no email delivery. */
  public static Map<String, Object> buildContract(String name, String email, String userId, String appOrigin) {
    return Map.of(
        "title", "Service Agreement",
        "metadata", Map.of("app_user_id", userId),
        "documents", List.of(Map.of(
            "url", "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
            "format", "pdf",
            "places", List.of(Map.of("key", "client_signature", "type", "signature", "recipient_key", "client")),
            "fixed_positions", List.of(Map.of("place_key", "client_signature", "page", 1, "top", 172, "left", 210)))),
        "recipients", List.of(Map.of(
            "key", "client",
            "type", "signer",
            "name", name,
            "email", email,
            "delivery_type", "none",
            "ceremony", Map.of(
                "authentication", List.of(Map.of(
                    "type", "custom", "provider", "Acme Corp Portal", "data", Map.of("user_id", userId))),
                "embeddable_in", List.of(appOrigin)))));
  }

  public record SigningSession(String envelopeId, String ceremonyUrl) {}

  /**
   * Creates the envelope, then waits until it is in_progress: the ceremony refuses to open while the
   * envelope is still processing. The ceremony URL comes from that last read.
   */
  public SigningSession createSigningSession(String name, String email, String userId) throws InterruptedException {
    JsonNode envelope = call("POST", "/v1/envelopes", buildContract(name, email, userId, settings.appOrigin()));
    for (int attempt = 0; envelope.path("status").asText().equals("processing") && attempt < 30; attempt++) {
      Thread.sleep(1000);
      envelope = call("GET", "/v1/envelopes/" + envelope.path("id").asText(), null);
    }
    if (!envelope.path("status").asText().equals("in_progress")) {
      throw new ApiException("Envelope is " + envelope.path("status").asText() + ", not ready for signing");
    }
    return new SigningSession(
        envelope.path("id").asText(), envelope.path("recipients").path(0).path("ceremony").path("url").asText());
  }

  /**
   * Downloads the signed PDF of a completed envelope.
   *
   * <p>The deliverable URL is pre-signed and expires after 1 hour, so fetch a fresh one each time
   * instead of storing it. It needs no API key.
   */
  public byte[] downloadSignedPdf(String envelopeId) {
    JsonNode envelope = call("GET", "/v1/envelopes/" + envelopeId, null);
    String status = envelope.path("status").asText();
    if (!status.equals("completed") || envelope.path("deliverable").isMissingNode() || envelope.path("deliverable").isNull()) {
      throw new NotReadyException("Envelope is " + status + ". The signed PDF exists once it is completed.");
    }
    JsonNode deliverable = call("GET", "/v1/deliverables/" + envelope.path("deliverable").path("id").asText(), null);
    if (!deliverable.path("status").asText().equals("generated")) {
      throw new NotReadyException("Deliverable is " + deliverable.path("status").asText() + ". Try again in a few seconds.");
    }
    HttpRequest file = HttpRequest.newBuilder(URI.create(deliverable.path("url").asText())).timeout(Duration.ofSeconds(60)).build();
    return send(file, HttpResponse.BodyHandlers.ofByteArray()).body();
  }
}
