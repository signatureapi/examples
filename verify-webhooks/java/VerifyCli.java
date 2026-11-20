import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** Usage: SIGNATUREAPI_WEBHOOK_SECRET=whsec_... java -cp out VerifyCli [delivery.json] */
public final class VerifyCli {
  @SuppressWarnings("unchecked")
  public static void main(String[] args) throws Exception {
    Map<String, Object> vector =
        (Map<String, Object>) MiniJson.parse(Files.readString(Path.of("../test-vector.json")));
    Map<String, Object> delivery;
    long now;
    if (args.length > 0) {
      delivery = (Map<String, Object>) MiniJson.parse(Files.readString(Path.of(args[0])));
      now = System.currentTimeMillis() / 1000;
    } else {
      delivery = (Map<String, Object>) ((List<Object>) vector.get("cases")).get(0);
      now = (Long) vector.get("now");
    }
    String secret = System.getenv("SIGNATUREAPI_WEBHOOK_SECRET");
    if (secret == null || secret.isEmpty()) secret = (String) vector.get("secret");

    Map<String, String> headers = new TreeMap<>();
    ((Map<String, Object>) delivery.get("headers")).forEach((k, v) -> headers.put(k, (String) v));
    try {
      WebhookVerifier.verify(secret, headers, ((String) delivery.get("body")).getBytes(StandardCharsets.UTF_8), now, 300);
      System.out.println("valid signature");
    } catch (WebhookVerifier.VerificationException e) {
      System.err.println("invalid: " + e.getMessage());
      System.exit(1);
    }
  }
}
