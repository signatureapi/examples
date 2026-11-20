package com.example.tutorial;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

class ContractControllerTest {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final JsonNode VECTOR = read("../../verify-webhooks/test-vector.json");
  private static final String ENVELOPE_ID = "eb4cf433-a8af-4161-b37b-7ef57d423e56";
  private static final String CREATED_ID = "688d2c9f-5dbe-4bc4-bd0b-2e0459016be8";
  private static final String DELIVERABLE_ID = "del_5hN8sD2jKq7WxZ4mPv9Ta3";
  private static final String ORIGIN = "https://app.acme.example";
  private static final String FAKE_KEY = String.join("_", "key", "test", "offline");

  private static HttpServer mock;
  private static final AtomicReference<String> lastBody = new AtomicReference<>();

  private static JsonNode read(String path) {
    try {
      return JSON.readTree(Files.readString(Path.of(path)));
    } catch (IOException e) {
      throw new IllegalStateException(e);
    }
  }

  private static void reply(HttpExchange exchange, int status, String type, byte[] body) throws IOException {
    exchange.getResponseHeaders().add("Content-Type", type);
    exchange.sendResponseHeaders(status, body.length);
    exchange.getResponseBody().write(body);
    exchange.close();
  }

  private static void json(HttpExchange exchange, int status, String body) throws IOException {
    reply(exchange, status, "application/json", body.getBytes(StandardCharsets.UTF_8));
  }

  // A local mock of the SignatureAPI endpoints the app calls.
  @BeforeAll
  static void startMock() throws IOException {
    mock = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    mock.createContext("/", exchange -> {
      String path = exchange.getRequestURI().getPath();
      if (path.equals("/files/signed.pdf")) { // the deliverable URL is pre-signed: no API key
        reply(exchange, 200, "application/pdf", "%PDF-1.7 mock".getBytes(StandardCharsets.UTF_8));
      } else if (!FAKE_KEY.equals(exchange.getRequestHeaders().getFirst("X-API-Key"))) {
        json(exchange, 401, "{\"title\":\"Unauthorized\"}");
      } else if (exchange.getRequestMethod().equals("POST")) {
        lastBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        json(exchange, 201, "{\"id\":\"" + CREATED_ID + "\",\"status\":\"processing\"}");
      } else if (path.equals("/v1/envelopes/" + CREATED_ID)) { // the created envelope is ready on the first read
        json(exchange, 200, "{\"id\":\"" + CREATED_ID + "\",\"status\":\"in_progress\","
            + "\"recipients\":[{\"ceremony\":{\"url\":\"https://sign.signatureapi.com/en/start?token=mock\"}}]}");
      } else if (path.equals("/v1/deliverables/" + DELIVERABLE_ID)) {
        json(exchange, 200, "{\"id\":\"" + DELIVERABLE_ID + "\",\"status\":\"generated\",\"url\":\"http://127.0.0.1:"
            + mock.getAddress().getPort() + "/files/signed.pdf\"}");
      } else {
        json(exchange, 200, "{\"id\":\"" + ENVELOPE_ID + "\",\"status\":\"completed\",\"deliverable\":{\"id\":\"" + DELIVERABLE_ID + "\"}}");
      }
    });
    mock.start();
  }

  @AfterAll
  static void stopMock() {
    mock.stop(0);
  }

  private static MockMvc app(Clock clock) {
    var settings = SignatureApi.Settings.from(Map.of(
        "SIGNATUREAPI_KEY", FAKE_KEY,
        "SIGNATUREAPI_BASE_URL", "http://127.0.0.1:" + mock.getAddress().getPort(),
        "SIGNATUREAPI_WEBHOOK_SECRET", VECTOR.get("secret").asText(),
        "APP_ORIGIN", ORIGIN)::get);
    return MockMvcBuilders.standaloneSetup(new ContractController(new SignatureApi(settings), clock)).build();
  }

  private static JsonNode vectorCase(String name) {
    for (JsonNode c : VECTOR.get("cases")) {
      if (c.get("name").asText().equals(name)) {
        return c;
      }
    }
    throw new IllegalArgumentException(name);
  }

  private static MockHttpServletRequestBuilder webhook(String body, Map<String, String> headers) {
    // content(byte[]) sends the body string byte for byte.
    MockHttpServletRequestBuilder req =
        post("/webhooks/signatureapi").contentType(MediaType.APPLICATION_JSON).content(body.getBytes(StandardCharsets.UTF_8));
    headers.forEach(req::header);
    return req;
  }

  @Test
  void everyVectorCase() throws Exception {
    // A clock frozen at the vector's "now" makes the 5 minute tolerance deterministic.
    Clock frozen = Clock.fixed(Instant.ofEpochSecond(VECTOR.get("now").asLong()), ZoneOffset.UTC);
    for (JsonNode c : VECTOR.get("cases")) {
      Map<String, String> headers = new java.util.HashMap<>();
      c.get("headers").properties().forEach(e -> headers.put(e.getKey(), e.getValue().asText()));
      int expected = c.get("expect").asText().equals("valid") ? 200 : 400;
      assertEquals(expected, app(frozen).perform(webhook(c.get("body").asText(), headers)).andReturn().getResponse().getStatus(), c.get("name").asText());
    }
  }

  @Test
  void pageChecksOrigin() throws Exception {
    app(Clock.systemUTC()).perform(get("/")).andExpect(status().isOk())
        .andExpect(content().string(org.hamcrest.Matchers.containsString("event.origin !== CEREMONY_ORIGIN")));
  }

  @Test
  void createContract() throws Exception {
    app(Clock.systemUTC())
        .perform(post("/api/contracts").contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"Jane Doe\",\"email\":\"jane.doe@example.com\"}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.envelopeId").value(CREATED_ID));
    JsonNode recipient = JSON.readTree(lastBody.get()).get("recipients").get(0);
    assertEquals("none", recipient.get("delivery_type").asText());
    assertEquals(ORIGIN, recipient.get("ceremony").get("embeddable_in").get(0).asText());
    assertEquals("custom", recipient.get("ceremony").get("authentication").get(0).get("type").asText());
  }

  @Test
  void createRequiresFields() throws Exception {
    app(Clock.systemUTC()).perform(post("/api/contracts").contentType(MediaType.APPLICATION_JSON).content("{}"))
        .andExpect(status().isUnprocessableEntity());
  }

  @Test
  void webhookFlow() throws Exception {
    MockMvc mvc = app(Clock.systemUTC());
    String body = vectorCase("valid").get("body").asText();
    String id = "msg_2pVb7Kq9Xc4Lm8Rt";
    String ts = String.valueOf(Instant.now().getEpochSecond());
    Map<String, String> headers = Map.of("webhook-id", id, "webhook-timestamp", ts, "webhook-signature", "v1," + sign(id, ts, body));
    mvc.perform(webhook(body, headers)).andExpect(status().isOk()).andExpect(jsonPath("$.received").value(true));
    mvc.perform(webhook(body, headers)).andExpect(status().isOk()).andExpect(jsonPath("$.duplicate").value(true));
    String tampered = vectorCase("tampered_body").get("body").asText();
    mvc.perform(webhook(tampered, Map.of("webhook-id", "msg_other", "webhook-timestamp", ts, "webhook-signature", "v1," + sign(id, ts, body))))
        .andExpect(status().isBadRequest());
    mvc.perform(get("/api/contracts/" + ENVELOPE_ID)).andExpect(status().isOk())
        .andExpect(jsonPath("$.webhookEvents.length()").value(1))
        .andExpect(jsonPath("$.webhookEvents[0]").value("envelope.completed"));
  }

  private static String sign(String id, String ts, String body) throws Exception {
    byte[] key = Base64.getDecoder().decode(VECTOR.get("secret").asText().replaceFirst("^whsec_", ""));
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(key, "HmacSHA256"));
    return Base64.getEncoder().encodeToString(mac.doFinal((id + "." + ts + "." + body).getBytes(StandardCharsets.UTF_8)));
  }

  @Test
  void signedPdfStreamsFromTheDeliverable() throws Exception {
    byte[] pdf = app(Clock.systemUTC()).perform(get("/api/contracts/" + ENVELOPE_ID + "/signed.pdf"))
        .andExpect(status().isOk())
        .andExpect(content().contentType(MediaType.APPLICATION_PDF))
        .andExpect(header().string("Content-Disposition", "attachment; filename=\"signed-service-agreement.pdf\""))
        .andReturn().getResponse().getContentAsByteArray();
    assertTrue(new String(pdf, StandardCharsets.UTF_8).startsWith("%PDF"));
  }

  @Test
  @EnabledIfEnvironmentVariable(named = "SIGNATUREAPI_KEY", matches = ".+")
  void liveCreateEmbeddedEnvelope() throws Exception {
    SignatureApi api = new SignatureApi(SignatureApi.Settings.from(n -> n.equals("APP_ORIGIN") ? ORIGIN : System.getenv(n)));
    var session = api.createSigningSession("Jane Doe", "jane.doe@example.com", "usr_tutorial");
    assertTrue(session.envelopeId().matches("^[0-9a-f-]{36}$"));
    // Never print the ceremony URL: it is a bearer link for the signer.
    assertTrue(session.ceremonyUrl().startsWith("https://"));
  }

  // An automatic signer completes the envelope without a person, so the download step runs for real.
  @Test
  @EnabledIfEnvironmentVariable(named = "SIGNATUREAPI_KEY", matches = ".+")
  void liveDownloadSignedPdf() throws Exception {
    SignatureApi api = new SignatureApi(SignatureApi.Settings.from(System::getenv));
    byte[] png = Files.readAllBytes(Path.of("../../scripts/assets/acme-mark.png"));
    HttpRequest upload = HttpRequest.newBuilder(URI.create(api.settings().baseUrl() + "/v1/uploads"))
        .header("X-API-Key", api.settings().apiKey())
        .header("Content-Type", "image/png")
        .POST(HttpRequest.BodyPublishers.ofByteArray(png))
        .build();
    HttpResponse<String> uploaded = HttpClient.newHttpClient().send(upload, HttpResponse.BodyHandlers.ofString());
    assertEquals(201, uploaded.statusCode());
    String url = JSON.readTree(uploaded.body()).get("url").asText();

    Map<String, Object> body = new java.util.HashMap<>(
        SignatureApi.buildContract("Jane Doe", "jane.doe@example.com", "usr_tutorial", ORIGIN));
    body.put("recipients", java.util.List.of(Map.of(
        "key", "client", "type", "automatic_signer", "name", "Jane Doe",
        "signature", Map.of("type", "drawn", "url", url),
        "mandate", "Authorized by Acme Corp board resolution 2026-04 (synthetic example)")));
    String id = api.call("POST", "/v1/envelopes", body).get("id").asText();

    byte[] pdf = null;
    for (int i = 0; i < 60 && pdf == null; i++) {
      Thread.sleep(2000);
      try {
        pdf = api.downloadSignedPdf(id);
      } catch (SignatureApi.NotReadyException retry) {
        // Not completed yet: try again.
      }
    }
    assertNotNull(pdf, "the signed PDF was not ready within 120 seconds");
    assertTrue(new String(pdf, 0, 4, StandardCharsets.US_ASCII).equals("%PDF"));
  }
}
