using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace WebhookApi.Tests;

/// <summary>A clock frozen at the test vector's "now", so the 5 minute tolerance is deterministic.</summary>
internal sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => now;
}

public class WebhookTests
{
    private static readonly JsonElement Vector = JsonDocument.Parse(File.ReadAllText(FindVector())).RootElement;

    private static string FindVector()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "verify-webhooks", "test-vector.json")))
            dir = dir.Parent;
        return Path.Combine(dir!.FullName, "verify-webhooks", "test-vector.json");
    }

    private static HttpClient NewClient()
    {
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
                config.AddInMemoryCollection(new Dictionary<string, string?> { ["SIGNATUREAPI_WEBHOOK_SECRET"] = Vector.GetProperty("secret").GetString() }));
            builder.ConfigureTestServices(services =>
                services.AddSingleton<TimeProvider>(new FixedTimeProvider(DateTimeOffset.FromUnixTimeSeconds(Vector.GetProperty("now").GetInt64()))));
        });
        return factory.CreateClient();
    }

    private static async Task<HttpResponseMessage> Post(HttpClient client, string caseName)
    {
        var c = Vector.GetProperty("cases").EnumerateArray().First(x => x.GetProperty("name").GetString() == caseName);
        // StringContent sends the body string byte for byte.
        var request = new HttpRequestMessage(HttpMethod.Post, "/webhooks/signatureapi")
        {
            Content = new StringContent(c.GetProperty("body").GetString()!, Encoding.UTF8, "application/json"),
        };
        foreach (var h in c.GetProperty("headers").EnumerateObject())
            request.Headers.Add(h.Name, h.Value.GetString());
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task ValidDeliveryReturns2xx() =>
        Assert.Equal(HttpStatusCode.OK, (await Post(NewClient(), "valid")).StatusCode);

    [Fact]
    public async Task RepeatedWebhookIdIsADuplicate()
    {
        var client = NewClient();
        await Post(client, "valid");
        var second = await Post(client, "valid");
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.Contains("duplicate", await second.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task TamperedBodyReturns4xx() =>
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(NewClient(), "tampered_body")).StatusCode);

    [Fact]
    public async Task WrongSecretReturns4xx() =>
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(NewClient(), "wrong_secret_signature")).StatusCode);

    [Fact]
    public async Task MissingHeadersReturn4xx() =>
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(NewClient(), "missing_headers")).StatusCode);
}
