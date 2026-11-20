using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace SignatureApiScripts;

public sealed class ApiException(string message, int status = 0) : Exception(message)
{
    public int Status { get; } = status;
}

/// <summary>Tiny, dependency-free client for the three calls these scripts need.</summary>
public sealed class SignatureApiClient
{
    public const string DefaultBaseUrl = "https://api.signatureapi.com";
    public const string SamplePdfUrl = "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf";

    private readonly string _apiKey;
    private readonly string _baseUrl;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(30) };

    public SignatureApiClient(string apiKey, string baseUrl)
    {
        _apiKey = apiKey;
        _baseUrl = baseUrl.TrimEnd('/');
    }

    /// <summary>Reads SIGNATUREAPI_KEY and SIGNATUREAPI_BASE_URL. Test keys only.</summary>
    public static SignatureApiClient FromEnv(Func<string, string?> env)
    {
        var key = env("SIGNATUREAPI_KEY");
        if (string.IsNullOrEmpty(key))
            throw new ApiException("Set SIGNATUREAPI_KEY to your test API key (it starts with key_test_).");
        if (!key.StartsWith("key_test_"))
            throw new ApiException("These examples run in test mode only. Use a key that starts with key_test_.");
        var baseUrl = env("SIGNATUREAPI_BASE_URL");
        return new SignatureApiClient(key, string.IsNullOrEmpty(baseUrl) ? DefaultBaseUrl : baseUrl);
    }

    /// <summary>
    /// A one-signer envelope for the sample Service Agreement. The sample PDF has no [[placeholders]],
    /// so the signature place uses fixed positions (points, page 1).
    /// </summary>
    public static JsonObject BuildServiceAgreement(string name = "Jane Doe", string email = "jane.doe@example.com") => new()
    {
        ["title"] = "Service Agreement",
        ["message"] = "Hi, please review and sign the Acme Corp Service Agreement.",
        ["metadata"] = new JsonObject(),
        ["documents"] = new JsonArray(new JsonObject
        {
            ["url"] = SamplePdfUrl,
            ["format"] = "pdf",
            ["places"] = new JsonArray(new JsonObject { ["key"] = "client_signature", ["type"] = "signature", ["recipient_key"] = "client" }),
            ["fixed_positions"] = new JsonArray(new JsonObject { ["place_key"] = "client_signature", ["page"] = 1, ["top"] = 172, ["left"] = 210 }),
        }),
        ["recipients"] = new JsonArray(new JsonObject { ["key"] = "client", ["type"] = "signer", ["name"] = name, ["email"] = email }),
    };

    private async Task<JsonNode> RequestAsync(HttpMethod method, string path, JsonNode? json = null)
    {
        using var request = new HttpRequestMessage(method, _baseUrl + path);
        request.Headers.Add("X-API-Key", _apiKey);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (json is not null) request.Content = new StringContent(json.ToJsonString(), Encoding.UTF8, "application/json");
        using var response = await _http.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
            throw new ApiException($"SignatureAPI returned {(int)response.StatusCode}: {text}", (int)response.StatusCode);
        return JsonNode.Parse(text)!;
    }

    public Task<JsonNode> SendEnvelopeAsync(string name = "Jane Doe", string email = "jane.doe@example.com") =>
        RequestAsync(HttpMethod.Post, "/v1/envelopes", BuildServiceAgreement(name, email));

    public Task<JsonNode> GetEnvelopeAsync(string envelopeId) =>
        RequestAsync(HttpMethod.Get, "/v1/envelopes/" + Uri.EscapeDataString(envelopeId));

    /// <summary>Saves the signed PDF of a completed envelope. Returns the deliverable id and byte count.</summary>
    public async Task<(string Id, int Bytes)> DownloadDeliverableAsync(string envelopeId, string outputPath)
    {
        var envelope = await GetEnvelopeAsync(envelopeId);
        var status = (string?)envelope["status"];
        if (status != "completed")
            throw new ApiException($"Envelope is {status}. The deliverable exists once the envelope is completed.");
        if (envelope["deliverable"] is not JsonNode reference)
            throw new ApiException("The envelope has no deliverable yet. Try again in a few seconds.");
        var deliverable = await RequestAsync(HttpMethod.Get, "/v1/deliverables/" + Uri.EscapeDataString((string)reference["id"]!));
        if ((string?)deliverable["status"] != "generated")
            throw new ApiException($"Deliverable is {(string?)deliverable["status"]}. Try again once it is generated.");

        // deliverable.url is a pre-signed link that expires after 1 hour. Do not send the API key to it.
        using var response = await _http.GetAsync((string)deliverable["url"]!);
        if (!response.IsSuccessStatusCode) throw new ApiException($"Download failed with {(int)response.StatusCode}", (int)response.StatusCode);
        var bytes = await response.Content.ReadAsByteArrayAsync();
        await File.WriteAllBytesAsync(outputPath, bytes);
        return ((string)deliverable["id"]!, bytes.Length);
    }
}
