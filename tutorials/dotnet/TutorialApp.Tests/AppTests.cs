using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace TutorialApp.Tests;

/// <summary>A clock frozen at the test vector's "now", so the 5 minute tolerance is deterministic.</summary>
internal sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => now;
}

/// <summary>Runs only when SIGNATUREAPI_KEY is set (a test key); otherwise it is skipped.</summary>
public sealed class LiveFactAttribute : FactAttribute
{
    public LiveFactAttribute()
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("SIGNATUREAPI_KEY")))
            Skip = "live test: set SIGNATUREAPI_KEY to a test key";
    }
}

/// <summary>A local mock of the SignatureAPI endpoints the app calls.</summary>
public sealed class MockApi : IAsyncLifetime
{
    public const string EnvelopeId = "eb4cf433-a8af-4161-b37b-7ef57d423e56";
    public const string CreatedId = "688d2c9f-5dbe-4bc4-bd0b-2e0459016be8";
    public const string DeliverableId = "del_5hN8sD2jKq7WxZ4mPv9Ta3";
    public static readonly string FakeKey = string.Join("_", "key", "test", "offline");

    private WebApplication? _app;
    public string Url { get; private set; } = "";
    public string? LastBody { get; private set; }

    public async Task InitializeAsync()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        _app = builder.Build();
        _app.Run(async context =>
        {
            var path = context.Request.Path.Value!;
            if (path == "/files/signed.pdf") // the deliverable URL is pre-signed: no API key
            {
                context.Response.ContentType = "application/pdf";
                await context.Response.Body.WriteAsync(Encoding.ASCII.GetBytes("%PDF-1.7 mock"));
                return;
            }
            if (context.Request.Headers["X-API-Key"] != FakeKey)
            {
                context.Response.StatusCode = 401;
                await context.Response.WriteAsJsonAsync(new { title = "Unauthorized" });
                return;
            }
            if (context.Request.Method == "POST")
            {
                using var reader = new StreamReader(context.Request.Body);
                LastBody = await reader.ReadToEndAsync();
                context.Response.StatusCode = 201;
                await context.Response.WriteAsJsonAsync(new { id = CreatedId, status = "processing" });
            }
            else if (path == $"/v1/envelopes/{CreatedId}") // the created envelope is ready on the first read
            {
                await context.Response.WriteAsJsonAsync(new
                {
                    id = CreatedId,
                    status = "in_progress",
                    recipients = new[] { new { ceremony = new { url = "https://sign.signatureapi.com/en/start?token=mock" } } },
                });
            }
            else if (path == $"/v1/deliverables/{DeliverableId}")
            {
                await context.Response.WriteAsJsonAsync(new { id = DeliverableId, status = "generated", url = $"{Url}/files/signed.pdf" });
            }
            else
            {
                await context.Response.WriteAsJsonAsync(new { id = EnvelopeId, status = "completed", deliverable = new { id = DeliverableId } });
            }
        });
        await _app.StartAsync();
        Url = _app.Urls.First();
    }

    public async Task DisposeAsync()
    {
        if (_app is not null) await _app.DisposeAsync();
    }
}

public class AppTests(MockApi mock) : IClassFixture<MockApi>
{
    private const string Origin = "https://app.acme.example";
    private static readonly JsonElement Vector = JsonDocument.Parse(File.ReadAllText(RepoFile("verify-webhooks/test-vector.json"))).RootElement;

    private static string RepoFile(string relative)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "verify-webhooks")))
            dir = dir.Parent;
        return Path.Combine(dir!.FullName, relative);
    }

    private HttpClient NewClient(TimeProvider? clock = null)
    {
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["SIGNATUREAPI_KEY"] = MockApi.FakeKey,
                ["SIGNATUREAPI_BASE_URL"] = mock.Url,
                ["SIGNATUREAPI_WEBHOOK_SECRET"] = Vector.GetProperty("secret").GetString(),
                ["APP_ORIGIN"] = Origin,
            }));
            if (clock is not null) builder.ConfigureTestServices(services => services.AddSingleton(clock));
        });
        return factory.CreateClient();
    }

    private static JsonElement Case(string name) =>
        Vector.GetProperty("cases").EnumerateArray().First(c => c.GetProperty("name").GetString() == name);

    private static Task<HttpResponseMessage> PostWebhook(HttpClient client, string body, IEnumerable<KeyValuePair<string, string>> headers)
    {
        // StringContent sends the body string byte for byte.
        var request = new HttpRequestMessage(HttpMethod.Post, "/webhooks/signatureapi")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        foreach (var (name, value) in headers) request.Headers.Add(name, value);
        return client.SendAsync(request);
    }

    [Fact]
    public async Task EveryVectorCase()
    {
        var frozen = new FixedTimeProvider(DateTimeOffset.FromUnixTimeSeconds(Vector.GetProperty("now").GetInt64()));
        foreach (var c in Vector.GetProperty("cases").EnumerateArray())
        {
            var headers = c.GetProperty("headers").EnumerateObject().Select(h => KeyValuePair.Create(h.Name, h.Value.GetString()!));
            var response = await PostWebhook(NewClient(frozen), c.GetProperty("body").GetString()!, headers);
            var expected = c.GetProperty("expect").GetString() == "valid" ? HttpStatusCode.OK : HttpStatusCode.BadRequest;
            Assert.True(expected == response.StatusCode, c.GetProperty("name").GetString());
        }
    }

    [Fact]
    public async Task PageChecksOrigin() =>
        Assert.Contains("event.origin !== CEREMONY_ORIGIN", await NewClient().GetStringAsync("/"));

    [Fact]
    public async Task CreateContract()
    {
        var response = await NewClient().PostAsJsonAsync("/api/contracts", new { name = "Jane Doe", email = "jane.doe@example.com" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(MockApi.CreatedId, (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("envelopeId").GetString());
        var recipient = JsonDocument.Parse(mock.LastBody!).RootElement.GetProperty("recipients")[0];
        Assert.Equal("none", recipient.GetProperty("delivery_type").GetString());
        var ceremony = recipient.GetProperty("ceremony");
        Assert.Equal(Origin, ceremony.GetProperty("embeddable_in")[0].GetString());
        Assert.Equal("custom", ceremony.GetProperty("authentication")[0].GetProperty("type").GetString());
    }

    [Fact]
    public async Task CreateRequiresFields() =>
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await NewClient().PostAsJsonAsync("/api/contracts", new { })).StatusCode);

    [Fact]
    public async Task WebhookFlow()
    {
        var client = NewClient();
        var body = Case("valid").GetProperty("body").GetString()!;
        var id = "msg_2pVb7Kq9Xc4Lm8Rt";
        var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        var headers = new Dictionary<string, string> { ["webhook-id"] = id, ["webhook-timestamp"] = ts, ["webhook-signature"] = "v1," + Sign(id, ts, body) };

        var accepted = await PostWebhook(client, body, headers);
        Assert.Contains("\"received\":true", await accepted.Content.ReadAsStringAsync());
        var again = await PostWebhook(client, body, headers);
        Assert.Contains("\"duplicate\":true", await again.Content.ReadAsStringAsync());
        var tampered = Case("tampered_body").GetProperty("body").GetString()!;
        var bad = await PostWebhook(client, tampered, new Dictionary<string, string>(headers) { ["webhook-id"] = "msg_other" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);

        var status = await client.GetFromJsonAsync<JsonElement>($"/api/contracts/{MockApi.EnvelopeId}");
        var events = status.GetProperty("webhookEvents").EnumerateArray().Select(e => e.GetString()).ToList();
        Assert.Equal("envelope.completed", Assert.Single(events));
    }

    private static string Sign(string id, string ts, string body)
    {
        var key = Convert.FromBase64String(Vector.GetProperty("secret").GetString()!["whsec_".Length..]);
        return Convert.ToBase64String(new HMACSHA256(key).ComputeHash(Encoding.UTF8.GetBytes($"{id}.{ts}.{body}")));
    }

    [Fact]
    public async Task SignedPdfStreamsFromTheDeliverable()
    {
        var response = await NewClient().GetAsync($"/api/contracts/{MockApi.EnvelopeId}/signed.pdf");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/pdf", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("attachment; filename=\"signed-service-agreement.pdf\"", response.Content.Headers.ContentDisposition?.ToString());
        Assert.StartsWith("%PDF", Encoding.ASCII.GetString(await response.Content.ReadAsByteArrayAsync()));
    }

    private static SignatureApi LiveApi() =>
        new(Settings.From(name => name == "APP_ORIGIN" ? Origin : Environment.GetEnvironmentVariable(name)));

    [LiveFact]
    public async Task LiveCreateEmbeddedEnvelope()
    {
        var (envelopeId, ceremonyUrl) = await LiveApi().CreateSigningSessionAsync("Jane Doe", "jane.doe@example.com", "usr_tutorial");
        Assert.Matches("^[0-9a-f-]{36}$", envelopeId);
        // Never print the ceremony URL: it is a bearer link for the signer.
        Assert.StartsWith("https://", ceremonyUrl);
    }

    // An automatic signer completes the envelope without a person, so the download step runs for real.
    [LiveFact]
    public async Task LiveDownloadSignedPdf()
    {
        var api = LiveApi();
        using var http = new HttpClient();
        using var upload = new HttpRequestMessage(HttpMethod.Post, api.Settings.BaseUrl + "/v1/uploads")
        {
            Content = new ByteArrayContent(await File.ReadAllBytesAsync(RepoFile("scripts/assets/acme-mark.png"))),
        };
        upload.Headers.Add("X-API-Key", api.Settings.ApiKey);
        upload.Content.Headers.ContentType = new("image/png");
        var uploaded = await http.SendAsync(upload);
        Assert.Equal(HttpStatusCode.Created, uploaded.StatusCode);
        var url = (await uploaded.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("url").GetString();

        var body = SignatureApi.BuildContract("Jane Doe", "jane.doe@example.com", "usr_tutorial", Origin);
        body["recipients"] = new[]
        {
            new
            {
                key = "client", type = "automatic_signer", name = "Jane Doe",
                signature = new { type = "drawn", url },
                mandate = "Authorized by Acme Corp board resolution 2026-04 (synthetic example)",
            },
        };
        var id = (string)(await api.CallAsync(HttpMethod.Post, "/v1/envelopes", body))["id"]!;

        byte[]? pdf = null;
        for (var i = 0; i < 60 && pdf is null; i++)
        {
            await Task.Delay(2000);
            try { pdf = await api.DownloadSignedPdfAsync(id); }
            catch (NotReadyException) { /* Not completed yet: try again. */ }
        }
        Assert.NotNull(pdf);
        Assert.StartsWith("%PDF", Encoding.ASCII.GetString(pdf));
    }
}
