using System.Security.Cryptography;
using System.Text;

/// <summary>Verifies Standard Webhooks signatures with the .NET base library only.</summary>
public static class WebhookVerifier
{
    public sealed class VerificationException(string message) : Exception(message);

    /// <summary>
    /// Returns normally when the delivery is authentic, otherwise throws VerificationException.
    /// rawBody must be the exact bytes received, never a re-serialized object.
    /// </summary>
    public static void Verify(
        string secret,
        IDictionary<string, string> headers,
        byte[] rawBody,
        long nowSeconds,
        long toleranceSeconds = 300)
    {
        var lower = new Dictionary<string, string>(headers, StringComparer.OrdinalIgnoreCase);
        lower.TryGetValue("webhook-id", out var id);
        lower.TryGetValue("webhook-timestamp", out var timestamp);
        lower.TryGetValue("webhook-signature", out var signatureHeader);
        if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(timestamp) || string.IsNullOrEmpty(signatureHeader))
            throw new VerificationException("Missing webhook-id, webhook-timestamp or webhook-signature header");
        if (!long.TryParse(timestamp, out var seconds) || seconds < 0)
            throw new VerificationException("Invalid webhook-timestamp");
        if (Math.Abs(nowSeconds - seconds) > toleranceSeconds)
            throw new VerificationException("Timestamp outside the tolerance window");

        byte[] key;
        try
        {
            key = Convert.FromBase64String(secret.StartsWith("whsec_") ? secret["whsec_".Length..] : secret);
        }
        catch (FormatException)
        {
            throw new VerificationException("Secret is not valid base64");
        }
        using var hmac = new HMACSHA256(key);
        var prefix = Encoding.UTF8.GetBytes($"{id}.{timestamp}.");
        var expected = hmac.ComputeHash([.. prefix, .. rawBody]);

        // The header holds space-separated "v1,<base64>" entries. Any match is enough.
        foreach (var entry in signatureHeader.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = entry.Split(',', 2);
            if (parts.Length != 2 || parts[0] != "v1") continue;
            try
            {
                if (CryptographicOperations.FixedTimeEquals(Convert.FromBase64String(parts[1]), expected)) return;
            }
            catch (FormatException)
            {
                // Not base64: try the next entry.
            }
        }
        throw new VerificationException("No matching signature");
    }
}
