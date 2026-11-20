import java.util.List;
import java.util.Map;

/** Send the sample Service Agreement to one signer. Usage: java -cp out SendEnvelope [name] [email] */
public final class SendEnvelope {
  @SuppressWarnings("unchecked")
  public static void main(String[] args) {
    String name = args.length > 1 ? args[0] : "Jane Doe";
    String email = args.length > 1 ? args[1] : "jane.doe@example.com";
    try {
      Map<String, Object> envelope = SignatureApiClient.fromEnv(System.getenv()).sendEnvelope(name, email);
      System.out.println("Envelope created: " + envelope.get("id"));
      System.out.println("Status: " + envelope.get("status"));
      for (Object o : (List<Object>) envelope.get("recipients")) {
        Map<String, Object> r = (Map<String, Object>) o;
        System.out.printf("Recipient %s: %s <%s> (%s)%n", r.get("key"), r.get("name"), r.get("email"), r.get("status"));
      }
    } catch (SignatureApiClient.ApiException e) {
      System.err.println("Error: " + e.getMessage());
      System.exit(1);
    }
  }
}
