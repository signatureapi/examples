import java.util.List;
import java.util.Map;

/** Print the status of an envelope and each recipient. Usage: java -cp out GetStatus <envelope-id> */
public final class GetStatus {
  @SuppressWarnings("unchecked")
  public static void main(String[] args) {
    if (args.length < 1) {
      System.err.println("Usage: java -cp out GetStatus <envelope-id>");
      System.exit(1);
    }
    try {
      Map<String, Object> envelope = SignatureApiClient.fromEnv(System.getenv()).getEnvelope(args[0]);
      System.out.printf("Envelope %s: %s%n", envelope.get("id"), envelope.get("status"));
      for (Object o : (List<Object>) envelope.get("recipients")) {
        Map<String, Object> r = (Map<String, Object>) o;
        System.out.printf("  %s (%s): %s%n", r.get("key"), r.get("type"), r.get("status"));
      }
      Map<String, Object> d = (Map<String, Object>) envelope.get("deliverable");
      if (d != null) {
        System.out.printf("Deliverable %s: %s%n", d.get("id"), d.get("status"));
      }
    } catch (SignatureApiClient.ApiException e) {
      System.err.println("Error: " + e.getMessage());
      System.exit(1);
    }
  }
}
