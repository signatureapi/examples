import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/** Tiny, dependency-free client for the three calls these scripts need (JDK HttpClient). */
public final class SignatureApiClient {
  public static final String DEFAULT_BASE_URL = "https://api.signatureapi.com";
  public static final String SAMPLE_PDF_URL =
      "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf";

  public static final class ApiException extends RuntimeException {
    private static final long serialVersionUID = 1L;

    public final int status;

    public ApiException(String message, int status) {
      super(message);
      this.status = status;
    }
  }

  private final String apiKey;
  private final String baseUrl;
  private final HttpClient http = HttpClient.newHttpClient();

  public SignatureApiClient(String apiKey, String baseUrl) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replaceAll("/+$", "");
  }

  /** Reads SIGNATUREAPI_KEY and SIGNATUREAPI_BASE_URL. Test keys only. */
  public static SignatureApiClient fromEnv(Map<String, String> env) {
    String key = env.get("SIGNATUREAPI_KEY");
    if (key == null || key.isEmpty()) {
      throw new ApiException("Set SIGNATUREAPI_KEY to your test API key (it starts with key_test_).", 0);
    }
    if (!key.startsWith("key_test_")) {
      throw new ApiException("These examples run in test mode only. Use a key that starts with key_test_.", 0);
    }
    String base = env.get("SIGNATUREAPI_BASE_URL");
    return new SignatureApiClient(key, base == null || base.isEmpty() ? DEFAULT_BASE_URL : base);
  }

  /**
   * A one-signer envelope for the sample Service Agreement. The sample PDF has no [[placeholders]],
   * so the signature place uses fixed positions (points, page 1).
   */
  public static String buildServiceAgreement(String name, String email) {
    return """
        {"title":"Service Agreement",\
        "message":"Hi, please review and sign the Acme Corp Service Agreement.",\
        "metadata":{},\
        "documents":[{"url":"%s","format":"pdf",\
        "places":[{"key":"client_signature","type":"signature","recipient_key":"client"}],\
        "fixed_positions":[{"place_key":"client_signature","page":1,"top":172,"left":210}]}],\
        "recipients":[{"key":"client","type":"signer","name":"%s","email":"%s"}]}"""
        .formatted(SAMPLE_PDF_URL, escape(name), escape(email));
  }

  private static String escape(String s) {
    return s.replace("\\", "\\\\").replace("\"", "\\\"");
  }

  private HttpResponse<byte[]> send(String method, String url, String json, boolean authenticated)
      throws IOException, InterruptedException {
    HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url));
    if (authenticated) {
      b.header("X-API-Key", apiKey).header("Accept", "application/json");
    }
    if (json != null) {
      b.header("Content-Type", "application/json");
      b.method(method, HttpRequest.BodyPublishers.ofString(json));
    } else {
      b.method(method, HttpRequest.BodyPublishers.noBody());
    }
    return http.send(b.build(), HttpResponse.BodyHandlers.ofByteArray());
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> request(String method, String path, String json) {
    try {
      HttpResponse<byte[]> res = send(method, baseUrl + path, json, true);
      String text = new String(res.body(), StandardCharsets.UTF_8);
      if (res.statusCode() < 200 || res.statusCode() > 299) {
        throw new ApiException("SignatureAPI returned " + res.statusCode() + ": " + text, res.statusCode());
      }
      return (Map<String, Object>) MiniJson.parse(text);
    } catch (IOException | InterruptedException e) {
      throw new ApiException("Request failed: " + e.getMessage(), 0);
    }
  }

  public Map<String, Object> sendEnvelope(String name, String email) {
    return request("POST", "/v1/envelopes", buildServiceAgreement(name, email));
  }

  public Map<String, Object> getEnvelope(String envelopeId) {
    return request("GET", "/v1/envelopes/" + URLEncoder.encode(envelopeId, StandardCharsets.UTF_8), null);
  }

  /** Saves the signed PDF of a completed envelope. Returns the deliverable id. */
  @SuppressWarnings("unchecked")
  public String downloadDeliverable(String envelopeId, Path output) {
    Map<String, Object> envelope = getEnvelope(envelopeId);
    if (!"completed".equals(envelope.get("status"))) {
      throw new ApiException(
          "Envelope is " + envelope.get("status") + ". The deliverable exists once the envelope is completed.", 0);
    }
    Map<String, Object> ref = (Map<String, Object>) envelope.get("deliverable");
    if (ref == null) {
      throw new ApiException("The envelope has no deliverable yet. Try again in a few seconds.", 0);
    }
    Map<String, Object> deliverable =
        request("GET", "/v1/deliverables/" + URLEncoder.encode((String) ref.get("id"), StandardCharsets.UTF_8), null);
    if (!"generated".equals(deliverable.get("status"))) {
      throw new ApiException("Deliverable is " + deliverable.get("status") + ". Try again once it is generated.", 0);
    }
    try {
      // deliverable.url is a pre-signed link that expires after 1 hour. Do not send the API key to it.
      HttpResponse<byte[]> res = send("GET", (String) deliverable.get("url"), null, false);
      if (res.statusCode() != 200) {
        throw new ApiException("Download failed with " + res.statusCode(), res.statusCode());
      }
      Files.write(output, res.body());
      return (String) deliverable.get("id");
    } catch (IOException | InterruptedException e) {
      throw new ApiException("Download failed: " + e.getMessage(), 0);
    }
  }
}
