using System.Collections.Concurrent;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton(TimeProvider.System); // Tests replace this with a fixed clock.
builder.Services.AddSingleton(sp => Settings.From(name => sp.GetRequiredService<IConfiguration>()[name]));
builder.Services.AddSingleton<SignatureApi>();
builder.Services.AddSingleton<ContractStore>();
var app = builder.Build();
app.Services.GetRequiredService<Settings>(); // Fail fast when SIGNATUREAPI_KEY is not a test key.

app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (ApiException e)
    {
        context.Response.StatusCode = StatusCodes.Status502BadGateway;
        await context.Response.WriteAsJsonAsync(new { error = e.Message });
    }
});

// GET / serves wwwroot/index.html: the form, the ceremony iframe and the origin check.
app.UseDefaultFiles();
app.UseStaticFiles();

// Step 1: your server creates the envelope and hands the ceremony URL to the browser.
app.MapPost("/api/contracts", async (CreateContract data, SignatureApi api, ContractStore store) =>
{
    if (string.IsNullOrWhiteSpace(data.Name) || string.IsNullOrWhiteSpace(data.Email))
        return Results.Json(new { error = "name and email are required" }, statusCode: StatusCodes.Status422UnprocessableEntity);
    var userId = $"usr_{Guid.NewGuid():N}"[..12]; // your signed-in user's id
    var (envelopeId, ceremonyUrl) = await api.CreateSigningSessionAsync(data.Name, data.Email, userId);
    store.Contract(envelopeId).Status = "in_progress";
    return Results.Json(new { envelopeId, ceremonyUrl }, statusCode: StatusCodes.Status201Created);
});

// Step 4: confirm the real state on the server before acting on a browser event.
app.MapGet("/api/contracts/{id:guid}", async (Guid id, SignatureApi api, ContractStore store) =>
{
    var envelope = await api.CallAsync(HttpMethod.Get, $"/v1/envelopes/{id}");
    return Results.Json(new { envelopeId = (string?)envelope["id"], status = (string?)envelope["status"], webhookEvents = store.Contract(id.ToString()).Events.ToArray() });
});

// Step 5: stream the signed PDF through your server, so the browser never needs your API key.
app.MapGet("/api/contracts/{id:guid}/signed.pdf", async (Guid id, SignatureApi api, HttpContext context) =>
{
    try
    {
        var pdf = await api.DownloadSignedPdfAsync(id.ToString());
        context.Response.Headers.ContentDisposition = "attachment; filename=\"signed-service-agreement.pdf\"";
        return Results.File(pdf, "application/pdf");
    }
    catch (NotReadyException e)
    {
        return Results.Json(new { error = e.Message }, statusCode: StatusCodes.Status409Conflict);
    }
});

// Step 3: SignatureAPI calls this endpoint. Verify the RAW body (bytes), never re-serialized JSON.
app.MapPost("/webhooks/signatureapi", async (HttpRequest request, TimeProvider clock, ContractStore store, Settings settings, ILogger<Program> log) =>
{
    using var buffer = new MemoryStream();
    await request.Body.CopyToAsync(buffer);
    var rawBody = buffer.ToArray();

    var headers = request.Headers.ToDictionary(h => h.Key, h => h.Value.ToString(), StringComparer.OrdinalIgnoreCase);
    try
    {
        WebhookVerifier.Verify(settings.WebhookSecret, headers, rawBody, clock.GetUtcNow().ToUnixTimeSeconds());
    }
    catch (WebhookVerifier.VerificationException e)
    {
        return Results.Json(new { error = e.Message }, statusCode: StatusCodes.Status400BadRequest);
    }

    if (!store.SeenWebhookIds.TryAdd(headers["webhook-id"], true))
        return Results.Json(new { duplicate = true });

    using var doc = JsonDocument.Parse(rawBody);
    var type = doc.RootElement.GetProperty("type").GetString()!;
    var envelopeId = doc.RootElement.GetProperty("data").GetProperty("envelope_id").GetString() ?? "";
    var contract = store.Contract(envelopeId);
    contract.Events.Enqueue(type);
    if (type == "envelope.completed") contract.Status = "completed";
    log.LogInformation("webhook {Type} for envelope {EnvelopeId}", type, envelopeId);
    return Results.Json(new { received = true });
});

app.Run();

public record CreateContract(string? Name, string? Email);

public sealed class Contract
{
    public volatile string Status = "unknown";
    public ConcurrentQueue<string> Events { get; } = new();
}

// In production these live in your database.
public sealed class ContractStore
{
    private readonly ConcurrentDictionary<string, Contract> _contracts = new();
    public ConcurrentDictionary<string, bool> SeenWebhookIds { get; } = new();
    public Contract Contract(string envelopeId) => _contracts.GetOrAdd(envelopeId, _ => new Contract());
}

public partial class Program;
