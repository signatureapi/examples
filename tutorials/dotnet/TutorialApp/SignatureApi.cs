using System.Net.Http.Json;
using System.Text.Json.Nodes;

public sealed record Settings(string ApiKey, string BaseUrl, string WebhookSecret, string AppOrigin)
{
    /// <summary>Reads the settings from environment-style names. Fails fast without a test key.</summary>
    public static Settings From(Func<string, string?> get)
    {
        var key = get("SIGNATUREAPI_KEY") ?? "";
        if (!key.StartsWith("key_test_"))
            throw new InvalidOperationException("Set SIGNATUREAPI_KEY to a test API key (it starts with key_test_).");
        return new Settings(
            key,
            OrDefault(get("SIGNATUREAPI_BASE_URL"), "https://api.signatureapi.com").TrimEnd('/'),
            get("SIGNATUREAPI_WEBHOOK_SECRET") ?? "",
            OrDefault(get("APP_ORIGIN"), "http://localhost:5000"));
    }

    private static string OrDefault(string? value, string fallback) => string.IsNullOrEmpty(value) ? fallback : value;
}

public sealed class ApiException(string message) : Exception(message);

/// <summary>The deliverable is not ready yet. The app answers 409 and the user tries again.</summary>
public sealed class NotReadyException(string message) : Exception(message);

/// <summary>SignatureAPI client and envelope builder for the ASP.NET tutorial. HttpClient only.</summary>
public sealed class SignatureApi(Settings settings)
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(60) };

    public Settings Settings => settings;

    /// <summary>Calls the API with the X-API-Key header and returns the parsed JSON response.</summary>
    public async Task<JsonNode> CallAsync(HttpMethod method, string path, object? body = null)
    {
        using var request = new HttpRequestMessage(method, settings.BaseUrl + path);
        request.Headers.Add("X-API-Key", settings.ApiKey);
        request.Headers.Add("Accept", "application/json");
        if (body is not null) request.Content = JsonContent.Create(body);
        try
        {
            using var response = await Http.SendAsync(request);
            var text = await response.Content.ReadAsStringAsync();
            var parsed = string.IsNullOrWhiteSpace(text) ? null : JsonNode.Parse(text);
            if (!response.IsSuccessStatusCode)
            {
                var detail = (string?)parsed?["detail"] ?? (string?)parsed?["title"];
                throw new ApiException($"SignatureAPI returned {(int)response.StatusCode}" + (detail is null ? "" : $": {detail}"));
            }
            return parsed!;
        }
        catch (HttpRequestException)
        {
            throw new ApiException("Could not reach SignatureAPI");
        }
    }

    /// <summary>Envelope for an embedded ceremony: custom authentication, embeddable_in, no email delivery.</summary>
    public static Dictionary<string, object> BuildContract(string name, string email, string userId, string appOrigin) => new()
    {
        ["title"] = "Service Agreement",
        ["metadata"] = new { app_user_id = userId },
        ["documents"] = new[]
        {
            new
            {
                url = "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
                format = "pdf",
                places = new[] { new { key = "client_signature", type = "signature", recipient_key = "client" } },
                fixed_positions = new[] { new { place_key = "client_signature", page = 1, top = 172, left = 210 } },
            },
        },
        ["recipients"] = new[]
        {
            new
            {
                key = "client",
                type = "signer",
                name,
                email,
                delivery_type = "none",
                ceremony = new
                {
                    authentication = new[] { new { type = "custom", provider = "Acme Corp Portal", data = new { user_id = userId } } },
                    embeddable_in = new[] { appOrigin },
                },
            },
        },
    };

    /// <summary>
    /// Creates the envelope, then waits until it is in_progress: the ceremony refuses to open while the
    /// envelope is still processing. The ceremony URL comes from that last read.
    /// </summary>
    public async Task<(string EnvelopeId, string CeremonyUrl)> CreateSigningSessionAsync(string name, string email, string userId)
    {
        var envelope = await CallAsync(HttpMethod.Post, "/v1/envelopes", BuildContract(name, email, userId, settings.AppOrigin));
        for (var attempt = 0; (string?)envelope["status"] == "processing" && attempt < 30; attempt++)
        {
            await Task.Delay(1000);
            envelope = await CallAsync(HttpMethod.Get, $"/v1/envelopes/{(string?)envelope["id"]}");
        }
        if ((string?)envelope["status"] != "in_progress")
            throw new ApiException($"Envelope is {(string?)envelope["status"]}, not ready for signing");
        return ((string)envelope["id"]!, (string)envelope["recipients"]![0]!["ceremony"]!["url"]!);
    }

    /// <summary>
    /// Downloads the signed PDF of a completed envelope. The deliverable URL is pre-signed and expires after
    /// 1 hour, so fetch a fresh one each time instead of storing it. It needs no API key.
    /// </summary>
    public async Task<byte[]> DownloadSignedPdfAsync(string envelopeId)
    {
        var envelope = await CallAsync(HttpMethod.Get, $"/v1/envelopes/{envelopeId}");
        if ((string?)envelope["status"] != "completed" || envelope["deliverable"] is null)
            throw new NotReadyException($"Envelope is {(string?)envelope["status"]}. The signed PDF exists once it is completed.");
        var deliverable = await CallAsync(HttpMethod.Get, $"/v1/deliverables/{(string?)envelope["deliverable"]!["id"]}");
        if ((string?)deliverable["status"] != "generated")
            throw new NotReadyException($"Deliverable is {(string?)deliverable["status"]}. Try again in a few seconds.");
        try
        {
            return await Http.GetByteArrayAsync((string)deliverable["url"]!);
        }
        catch (HttpRequestException)
        {
            throw new ApiException("Could not download the signed PDF");
        }
    }
}
