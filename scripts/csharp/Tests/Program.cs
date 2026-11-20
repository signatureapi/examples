using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using SignatureApiScripts;

// Run with: dotnet run --project Tests
// Offline tests use a local HttpListener as the mock API. The live test skips without SIGNATUREAPI_KEY.
const string EnvelopeId = "eb4cf433-a8af-4161-b37b-7ef57d423e56";
const string DeliverableId = "del_5hN8sD2jKq7WxZ4mPv9Ta3";
const string FakeKey = "key_test_fake";

int passed = 0, failed = 0, skipped = 0;
void Check(string name, bool ok)
{
    if (ok) passed++; else failed++;
    Console.WriteLine($"{(ok ? "ok   - " : "FAIL - ")}{name}");
}
async Task<bool> Throws(Func<Task> action, string contains)
{
    try { await action(); } catch (ApiException e) { return e.Message.Contains(contains); }
    return false;
}

var seen = new List<(string Method, string Path, string? Key, string Body)>();
var port = new Random().Next(20000, 40000);
var baseUrl = $"http://127.0.0.1:{port}";
var listener = new HttpListener();
listener.Prefixes.Add(baseUrl + "/");
listener.Start();
var serve = Task.Run(async () =>
{
    while (listener.IsListening)
    {
        HttpListenerContext ctx;
        try { ctx = await listener.GetContextAsync(); } catch { break; }
        var req = ctx.Request;
        var key = req.Headers["X-API-Key"];
        var body = await new StreamReader(req.InputStream).ReadToEndAsync();
        var path = req.Url!.AbsolutePath;
        seen.Add((req.HttpMethod, path, key, body));
        int status = 200; var type = "application/json"; string output;
        if (path == "/signed.pdf") { status = key is null ? 200 : 400; type = "application/pdf"; output = key is null ? "%PDF-1.4 mock" : "key leaked"; }
        else if (key != FakeKey) { status = 401; output = "{\"title\":\"Unauthorized\"}"; }
        else if (req.HttpMethod == "POST" && path == "/v1/envelopes")
        {
            status = 201;
            output = $$"""{"id":"{{EnvelopeId}}","status":"processing","recipients":[{"key":"client","type":"signer","name":"Jane Doe","email":"jane.doe@example.com","status":"pending"}]}""";
        }
        else if (path == $"/v1/envelopes/{EnvelopeId}")
            output = "{\"id\":\"" + EnvelopeId + "\",\"status\":\"completed\",\"recipients\":[],\"deliverable\":{\"id\":\"" + DeliverableId + "\",\"status\":\"generated\"}}";
        else if (path == $"/v1/deliverables/{DeliverableId}")
            output = $$"""{"id":"{{DeliverableId}}","status":"generated","url":"{{baseUrl}}/signed.pdf"}""";
        else { status = 404; output = "{\"title\":\"Not Found\"}"; }
        var bytes = Encoding.UTF8.GetBytes(output);
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = type;
        ctx.Response.ContentLength64 = bytes.Length;
        await ctx.Response.OutputStream.WriteAsync(bytes);
        ctx.Response.Close();
    }
});

try
{
    Check("config requires a key", await Throws(() => { SignatureApiClient.FromEnv(_ => null); return Task.CompletedTask; }, "SIGNATUREAPI_KEY"));
    Check("config refuses live keys", await Throws(() => { SignatureApiClient.FromEnv(_ => "key_live_x"); return Task.CompletedTask; }, "test mode only"));

    var client = new SignatureApiClient(FakeKey, baseUrl);

    var envelope = await client.SendEnvelopeAsync();
    var first = seen[0];
    Check("send: returns the envelope id", (string?)envelope["id"] == EnvelopeId);
    Check("send: POST /v1/envelopes with the API key", first is { Method: "POST", Path: "/v1/envelopes", Key: FakeKey });
    var expected = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "expected-envelope.json")))!;
    Check("send: body matches expected-envelope.json", JsonNode.DeepEquals(expected, JsonNode.Parse(first.Body)));

    seen.Clear();
    var got = await client.GetEnvelopeAsync(EnvelopeId);
    Check("get: GET /v1/envelopes/{id} with the API key",
        (string?)got["status"] == "completed" && seen[0] is { Method: "GET", Key: FakeKey } && seen[0].Path == $"/v1/envelopes/{EnvelopeId}");

    seen.Clear();
    var output = Path.GetTempFileName();
    var (id, size) = await client.DownloadDeliverableAsync(EnvelopeId, output);
    Check("download: saves a PDF", id == DeliverableId && size > 0 && File.ReadAllText(output).StartsWith("%PDF"));
    Check("download: calls envelope, deliverable, then the signed URL",
        seen.Select(s => $"{s.Method} {s.Path}").SequenceEqual([$"GET /v1/envelopes/{EnvelopeId}", $"GET /v1/deliverables/{DeliverableId}", "GET /signed.pdf"]));
    Check("download: never sends the API key to the signed URL", seen[2].Key is null);

    Check("401 raises ApiException", await Throws(() => new SignatureApiClient("key_test_wrong", baseUrl).GetEnvelopeAsync(EnvelopeId), "returned 401"));

    // Live test: runs only with a test key.
    if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("SIGNATUREAPI_KEY")))
    {
        skipped++;
        Console.WriteLine("skip - live test: SIGNATUREAPI_KEY is not set");
    }
    else
    {
        var live = SignatureApiClient.FromEnv(Environment.GetEnvironmentVariable);
        var created = await live.SendEnvelopeAsync();
        Check("live: create and read back an envelope", (string?)(await live.GetEnvelopeAsync((string)created["id"]!))["id"] == (string?)created["id"]);
    }
}
finally
{
    listener.Stop();
}

Console.WriteLine($"{passed} passed, {failed} failed, {skipped} skipped");
return failed == 0 ? 0 : 1;
