using SignatureApiScripts;

// Three small programs in one project. Pick one with the first argument:
//   dotnet run -- send [name] [email]       send the sample Service Agreement to one signer
//   dotnet run -- status <envelope-id>      print the envelope and recipient statuses
//   dotnet run -- download <envelope-id> [output.pdf]   save the signed PDF of a completed envelope
try
{
    var command = args.FirstOrDefault();
    var client = SignatureApiClient.FromEnv(Environment.GetEnvironmentVariable);
    switch (command)
    {
        case "send":
        {
            var envelope = args.Length > 2 ? await client.SendEnvelopeAsync(args[1], args[2]) : await client.SendEnvelopeAsync();
            Console.WriteLine($"Envelope created: {(string?)envelope["id"]}");
            Console.WriteLine($"Status: {(string?)envelope["status"]}");
            foreach (var r in envelope["recipients"]!.AsArray())
                Console.WriteLine($"Recipient {(string?)r!["key"]}: {(string?)r["name"]} <{(string?)r["email"]}> ({(string?)r["status"]})");
            return 0;
        }
        case "status" when args.Length > 1:
        {
            var envelope = await client.GetEnvelopeAsync(args[1]);
            Console.WriteLine($"Envelope {(string?)envelope["id"]}: {(string?)envelope["status"]}");
            foreach (var r in envelope["recipients"]!.AsArray())
                Console.WriteLine($"  {(string?)r!["key"]} ({(string?)r["type"]}): {(string?)r["status"]}");
            if (envelope["deliverable"] is { } d)
                Console.WriteLine($"Deliverable {(string?)d["id"]}: {(string?)d["status"]}");
            return 0;
        }
        case "download" when args.Length > 1:
        {
            var output = args.Length > 2 ? args[2] : "signed-envelope.pdf";
            var (id, bytes) = await client.DownloadDeliverableAsync(args[1], output);
            Console.WriteLine($"Saved deliverable {id} to {output} ({bytes} bytes)");
            return 0;
        }
        default:
            Console.Error.WriteLine("Usage: dotnet run -- send [name] [email] | status <envelope-id> | download <envelope-id> [output.pdf]");
            return 1;
    }
}
catch (ApiException e)
{
    Console.Error.WriteLine($"Error: {e.Message}");
    return 1;
}
