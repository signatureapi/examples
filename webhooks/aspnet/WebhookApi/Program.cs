using System.Collections.Concurrent;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton(TimeProvider.System); // Tests replace this with a fixed clock.
builder.Services.AddSingleton<SeenWebhooks>();
var app = builder.Build();

app.MapPost("/webhooks/signatureapi", async (HttpRequest request, TimeProvider clock, SeenWebhooks seen, IConfiguration config, ILogger<Program> log) =>
{
    // Read the body as bytes, exactly as received. Binding a model parameter would deserialize it first,
    // and re-serializing the result does not give the bytes that were signed.
    using var buffer = new MemoryStream();
    await request.Body.CopyToAsync(buffer);
    var rawBody = buffer.ToArray();

    var headers = request.Headers.ToDictionary(h => h.Key, h => h.Value.ToString());
    try
    {
        WebhookVerifier.Verify(config["SIGNATUREAPI_WEBHOOK_SECRET"] ?? "", headers, rawBody, clock.GetUtcNow().ToUnixTimeSeconds());
    }
    catch (WebhookVerifier.VerificationException e)
    {
        return Results.Json(new { error = e.Message }, statusCode: StatusCodes.Status400BadRequest);
    }

    if (!seen.TryAdd(headers["webhook-id"]))
        return Results.Json(new { status = "duplicate" });

    using var doc = JsonDocument.Parse(rawBody);
    var data = doc.RootElement.GetProperty("data");
    switch (doc.RootElement.GetProperty("type").GetString())
    {
        case "envelope.completed":
            log.LogInformation("envelope {Id} completed", data.GetProperty("envelope_id").GetString());
            break;
        case "recipient.completed":
            log.LogInformation("recipient {Id} completed", data.GetProperty("object_id").GetString());
            break;
        case "deliverable.generated":
            log.LogInformation("deliverable {Id} is ready", data.GetProperty("object_id").GetString());
            break;
        default:
            break; // Acknowledge event types you do not handle so they are not retried.
    }

    // Respond fast. Hand slow work to a queue or a hosted background service.
    return Results.Json(new { status = "ok" });
});

app.Run();

// Production: replace with a shared store (see README). A dictionary only dedupes within one process.
public sealed class SeenWebhooks
{
    private readonly ConcurrentDictionary<string, bool> _ids = new();
    public bool TryAdd(string id) => _ids.TryAdd(id, true);
}

public partial class Program;
