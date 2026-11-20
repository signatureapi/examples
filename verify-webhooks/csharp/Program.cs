using System.Text;
using System.Text.Json;

// `dotnet run`                 runs every case in ../test-vector.json
// `dotnet run -- demo [file]`  verifies one delivery (SIGNATUREAPI_WEBHOOK_SECRET overrides the secret)
var vector = JsonDocument.Parse(File.ReadAllText("../test-vector.json")).RootElement;
var secret = vector.GetProperty("secret").GetString()!;
var now = vector.GetProperty("now").GetInt64();
var tolerance = vector.GetProperty("tolerance_seconds").GetInt64();

static (Dictionary<string, string> Headers, byte[] Body) Read(JsonElement c) =>
    (c.GetProperty("headers").EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetString()!),
     Encoding.UTF8.GetBytes(c.GetProperty("body").GetString()!));

static bool Passes(string secret, Dictionary<string, string> headers, byte[] body, long now, long tolerance)
{
    try { WebhookVerifier.Verify(secret, headers, body, now, tolerance); return true; }
    catch (WebhookVerifier.VerificationException) { return false; }
}

if (args.Length > 0 && args[0] == "demo")
{
    JsonElement delivery;
    long when;
    if (args.Length > 1) { delivery = JsonDocument.Parse(File.ReadAllText(args[1])).RootElement; when = DateTimeOffset.UtcNow.ToUnixTimeSeconds(); }
    else { delivery = vector.GetProperty("cases")[0]; when = now; }
    var envSecret = Environment.GetEnvironmentVariable("SIGNATUREAPI_WEBHOOK_SECRET");
    var (h, b) = Read(delivery);
    try
    {
        WebhookVerifier.Verify(string.IsNullOrEmpty(envSecret) ? secret : envSecret, h, b, when);
        Console.WriteLine("valid signature");
        return 0;
    }
    catch (WebhookVerifier.VerificationException e)
    {
        Console.Error.WriteLine($"invalid: {e.Message}");
        return 1;
    }
}

int passed = 0, failed = 0;
void Check(string name, bool ok)
{
    if (ok) passed++; else failed++;
    Console.WriteLine($"{(ok ? "ok   - " : "FAIL - ")}{name}");
}

foreach (var c in vector.GetProperty("cases").EnumerateArray())
{
    var (headers, body) = Read(c);
    Check($"test vector: {c.GetProperty("name").GetString()}",
        Passes(secret, headers, body, now, tolerance) == (c.GetProperty("expect").GetString() == "valid"));
}
var (first, firstBody) = Read(vector.GetProperty("cases")[0]);
Check("header names are case-insensitive",
    Passes(secret, first.ToDictionary(p => p.Key.ToUpperInvariant(), p => p.Value), firstBody, now, tolerance));

Console.WriteLine($"{passed} passed, {failed} failed");
return failed == 0 ? 0 : 1;
