import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Map;
import java.util.TreeMap;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Verifies Standard Webhooks signatures with the JDK only. */
public final class WebhookVerifier {
  public static final class VerificationException extends Exception {
    public VerificationException(String message) {
      super(message);
    }
  }

  private WebhookVerifier() {}

  /**
   * Returns normally when the delivery is authentic, otherwise throws VerificationException.
   *
   * @param secret signing secret, "whsec_&lt;base64 key&gt;"
   * @param headers request headers (names matched case-insensitively)
   * @param rawBody the exact bytes received, never a re-serialized object
   * @param nowSeconds reference time as Unix seconds (use System.currentTimeMillis() / 1000)
   */
  public static void verify(
      String secret,
      Map<String, String> headers,
      byte[] rawBody,
      long nowSeconds,
      long toleranceSeconds)
      throws VerificationException {
    Map<String, String> lower = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
    lower.putAll(headers);
    String id = lower.get("webhook-id");
    String timestamp = lower.get("webhook-timestamp");
    String signatureHeader = lower.get("webhook-signature");
    if (isEmpty(id) || isEmpty(timestamp) || isEmpty(signatureHeader)) {
      throw new VerificationException(
          "Missing webhook-id, webhook-timestamp or webhook-signature header");
    }
    if (!timestamp.matches("\\d{1,18}")) {
      throw new VerificationException("Invalid webhook-timestamp");
    }
    if (Math.abs(nowSeconds - Long.parseLong(timestamp)) > toleranceSeconds) {
      throw new VerificationException("Timestamp outside the tolerance window");
    }

    byte[] expected;
    try {
      byte[] key = Base64.getDecoder().decode(secret.replaceFirst("^whsec_", ""));
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(key, "HmacSHA256"));
      mac.update((id + "." + timestamp + ".").getBytes(StandardCharsets.UTF_8));
      expected = mac.doFinal(rawBody);
    } catch (Exception e) {
      throw new VerificationException("Cannot compute signature: " + e.getMessage());
    }

    // The header holds space-separated "v1,<base64>" entries. Any match is enough.
    for (String entry : signatureHeader.split(" ")) {
      String[] parts = entry.split(",", 2);
      if (parts.length != 2 || !parts[0].equals("v1")) {
        continue;
      }
      try {
        byte[] candidate = Base64.getDecoder().decode(parts[1]);
        if (MessageDigest.isEqual(candidate, expected)) {
          return;
        }
      } catch (IllegalArgumentException ignored) {
        // Not base64: try the next entry.
      }
    }
    throw new VerificationException("No matching signature");
  }

  private static boolean isEmpty(String value) {
    return value == null || value.isEmpty();
  }
}
