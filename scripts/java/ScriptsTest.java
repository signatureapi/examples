import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Offline tests against a local mock API, plus a live test that skips without SIGNATUREAPI_KEY. */
public final class ScriptsTest {
  static final String ENVELOPE_ID = "eb4cf433-a8af-4161-b37b-7ef57d423e56";
  static final String DELIVERABLE_ID = "del_5hN8sD2jKq7WxZ4mPv9Ta3";
  static final String FAKE_KEY = "key_test_fake";

  record Seen(String method, String path, String key, String body) {}

  static int passed = 0, failed = 0, skipped = 0;
  static final List<Seen> seen = new ArrayList<>();

  static void check(String name, boolean ok) {
    if (ok) passed++;
    else failed++;
    System.out.println((ok ? "ok   - " : "FAIL - ") + name);
  }

  public static void main(String[] args) throws Exception {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    String base = "http://127.0.0.1:" + server.getAddress().getPort();
    server.createContext("/", ex -> {
      String path = ex.getRequestURI().getPath();
      String key = ex.getRequestHeaders().getFirst("X-API-Key");
      String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
      seen.add(new Seen(ex.getRequestMethod(), path, key, body));
      int status = 200;
      String type = "application/json";
      String out;
      if (path.equals("/signed.pdf")) {
        status = key != null ? 400 : 200;
        type = "application/pdf";
        out = key != null ? "key leaked" : "%PDF-1.4 mock";
      } else if (!FAKE_KEY.equals(key)) {
        status = 401;
        out = "{\"title\":\"Unauthorized\"}";
      } else if (ex.getRequestMethod().equals("POST") && path.equals("/v1/envelopes")) {
        status = 201;
        out = "{\"id\":\"" + ENVELOPE_ID + "\",\"status\":\"processing\",\"recipients\":[{\"key\":\"client\",\"type\":\"signer\",\"name\":\"Jane Doe\",\"email\":\"jane.doe@example.com\",\"status\":\"pending\"}]}";
      } else if (path.equals("/v1/envelopes/" + ENVELOPE_ID)) {
        out = "{\"id\":\"" + ENVELOPE_ID + "\",\"status\":\"completed\",\"recipients\":[],\"deliverable\":{\"id\":\"" + DELIVERABLE_ID + "\",\"status\":\"generated\"}}";
      } else if (path.equals("/v1/deliverables/" + DELIVERABLE_ID)) {
        out = "{\"id\":\"" + DELIVERABLE_ID + "\",\"status\":\"generated\",\"url\":\"" + base + "/signed.pdf\"}";
      } else {
        status = 404;
        out = "{\"title\":\"Not Found\"}";
      }
      byte[] bytes = out.getBytes(StandardCharsets.UTF_8);
      ex.getResponseHeaders().add("Content-Type", type);
      ex.sendResponseHeaders(status, bytes.length);
      ex.getResponseBody().write(bytes);
      ex.close();
    });
    server.start();
    try {
      run(base);
    } finally {
      server.stop(0);
    }
    System.out.println(passed + " passed, " + failed + " failed, " + skipped + " skipped");
    System.exit(failed == 0 ? 0 : 1);
  }

  @SuppressWarnings("unchecked")
  static void run(String base) throws Exception {
    // Config
    check("config requires a key", throwsApi(() -> SignatureApiClient.fromEnv(Map.of()), "SIGNATUREAPI_KEY"));
    check("config refuses live keys", throwsApi(() -> SignatureApiClient.fromEnv(Map.of("SIGNATUREAPI_KEY", "key_live_x")), "test mode only"));

    SignatureApiClient client = new SignatureApiClient(FAKE_KEY, base);

    Map<String, Object> envelope = client.sendEnvelope("Jane Doe", "jane.doe@example.com");
    Seen req = seen.get(0);
    check("send: returns the envelope id", ENVELOPE_ID.equals(envelope.get("id")));
    check("send: POST /v1/envelopes with the API key", req.method().equals("POST") && req.path().equals("/v1/envelopes") && FAKE_KEY.equals(req.key()));
    Object expected = MiniJson.parse(Files.readString(Path.of("expected-envelope.json")));
    check("send: body matches expected-envelope.json", Objects.equals(expected, MiniJson.parse(req.body())));

    seen.clear();
    check("get: returns the envelope", "completed".equals(client.getEnvelope(ENVELOPE_ID).get("status")));
    req = seen.get(0);
    check("get: GET /v1/envelopes/{id} with the API key", req.method().equals("GET") && req.path().equals("/v1/envelopes/" + ENVELOPE_ID) && FAKE_KEY.equals(req.key()));

    seen.clear();
    Path out = Files.createTempFile("signed", ".pdf");
    String id = client.downloadDeliverable(ENVELOPE_ID, out);
    check("download: saves a PDF", DELIVERABLE_ID.equals(id) && Files.readString(out).startsWith("%PDF"));
    List<String> calls = seen.stream().map(s -> s.method() + " " + s.path()).toList();
    check("download: calls envelope, deliverable, then the signed URL",
        calls.equals(List.of("GET /v1/envelopes/" + ENVELOPE_ID, "GET /v1/deliverables/" + DELIVERABLE_ID, "GET /signed.pdf")));
    check("download: never sends the API key to the signed URL", seen.get(2).key() == null);

    check("401 raises ApiException", throwsApi(() -> new SignatureApiClient("key_test_wrong", base).getEnvelope(ENVELOPE_ID), "returned 401"));

    // Live test: runs only with a test key.
    String liveKey = System.getenv("SIGNATUREAPI_KEY");
    if (liveKey == null || liveKey.isEmpty()) {
      skipped++;
      System.out.println("skip - live test: SIGNATUREAPI_KEY is not set");
    } else {
      SignatureApiClient live = SignatureApiClient.fromEnv(System.getenv());
      Map<String, Object> created = live.sendEnvelope("Jane Doe", "jane.doe@example.com");
      check("live: create and read back an envelope", created.get("id").equals(live.getEnvelope((String) created.get("id")).get("id")));
    }
  }

  static boolean throwsApi(Runnable r, String contains) {
    try {
      r.run();
    } catch (SignatureApiClient.ApiException e) {
      return e.getMessage().contains(contains);
    }
    return false;
  }
}
