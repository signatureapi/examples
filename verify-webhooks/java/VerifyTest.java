import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** Runs every case in ../test-vector.json. Exit code 1 on any failure. */
public final class VerifyTest {
  private static int passed = 0;
  private static int failed = 0;

  @SuppressWarnings("unchecked")
  public static void main(String[] args) throws Exception {
    Map<String, Object> vector =
        (Map<String, Object>) MiniJson.parse(Files.readString(Path.of("../test-vector.json")));
    String secret = (String) vector.get("secret");
    long now = (Long) vector.get("now");
    long tolerance = (Long) vector.get("tolerance_seconds");

    for (Object o : (List<Object>) vector.get("cases")) {
      Map<String, Object> c = (Map<String, Object>) o;
      Map<String, String> headers = new TreeMap<>();
      ((Map<String, Object>) c.get("headers")).forEach((k, v) -> headers.put(k, (String) v));
      byte[] body = ((String) c.get("body")).getBytes(StandardCharsets.UTF_8);
      boolean ok;
      try {
        WebhookVerifier.verify(secret, headers, body, now, tolerance);
        ok = true;
      } catch (WebhookVerifier.VerificationException e) {
        ok = false;
      }
      check("test vector: " + c.get("name"), ok == c.get("expect").equals("valid"));
    }

    Map<String, Object> first = (Map<String, Object>) ((List<Object>) vector.get("cases")).get(0);
    Map<String, String> upper = new TreeMap<>();
    ((Map<String, Object>) first.get("headers")).forEach((k, v) -> upper.put(k.toUpperCase(), (String) v));
    boolean ok;
    try {
      WebhookVerifier.verify(secret, upper, ((String) first.get("body")).getBytes(StandardCharsets.UTF_8), now, tolerance);
      ok = true;
    } catch (WebhookVerifier.VerificationException e) {
      ok = false;
    }
    check("header names are case-insensitive", ok);

    System.out.println(passed + " passed, " + failed + " failed");
    System.exit(failed == 0 ? 0 : 1);
  }

  private static void check(String name, boolean ok) {
    if (ok) passed++;
    else failed++;
    System.out.println((ok ? "ok   - " : "FAIL - ") + name);
  }
}
