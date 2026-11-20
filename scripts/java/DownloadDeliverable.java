import java.nio.file.Files;
import java.nio.file.Path;

/** Download the signed PDF of a completed envelope. Usage: java -cp out DownloadDeliverable <envelope-id> [output.pdf] */
public final class DownloadDeliverable {
  public static void main(String[] args) throws Exception {
    if (args.length < 1) {
      System.err.println("Usage: java -cp out DownloadDeliverable <envelope-id> [output.pdf]");
      System.exit(1);
    }
    Path output = Path.of(args.length > 1 ? args[1] : "signed-envelope.pdf");
    try {
      String id = SignatureApiClient.fromEnv(System.getenv()).downloadDeliverable(args[0], output);
      System.out.printf("Saved deliverable %s to %s (%d bytes)%n", id, output, Files.size(output));
    } catch (SignatureApiClient.ApiException e) {
      System.err.println("Error: " + e.getMessage());
      System.exit(1);
    }
  }
}
