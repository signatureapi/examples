<?php

declare(strict_types=1);

// Tiny, dependency-free client for the three calls these scripts need. Uses PHP streams, no extensions.

const SIGNATUREAPI_DEFAULT_BASE_URL = 'https://api.signatureapi.com';
const SIGNATUREAPI_SAMPLE_PDF_URL = 'https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf';

final class SignatureApiException extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 0)
    {
        parent::__construct($message);
    }
}

/** Reads SIGNATUREAPI_KEY and SIGNATUREAPI_BASE_URL. Test keys only. @return array{api_key: string, base_url: string} */
function signatureapi_config(?array $env = null): array
{
    $env ??= getenv();
    $key = $env['SIGNATUREAPI_KEY'] ?? '';
    if ($key === '') {
        throw new SignatureApiException('Set SIGNATUREAPI_KEY to your test API key (it starts with key_test_).');
    }
    if (!str_starts_with($key, 'key_test_')) {
        throw new SignatureApiException('These examples run in test mode only. Use a key that starts with key_test_.');
    }
    $base = ($env['SIGNATUREAPI_BASE_URL'] ?? '') ?: SIGNATUREAPI_DEFAULT_BASE_URL;
    return ['api_key' => $key, 'base_url' => rtrim($base, '/')];
}

/** A one-signer envelope for the sample Service Agreement. The sample PDF has no [[placeholders]], so the place uses fixed positions (points, page 1). */
function build_service_agreement(string $name = 'Jane Doe', string $email = 'jane.doe@example.com'): array
{
    return [
        'title' => 'Service Agreement',
        'message' => 'Hi, please review and sign the Acme Corp Service Agreement.',
        'metadata' => new stdClass(),
        'documents' => [[
            'url' => SIGNATUREAPI_SAMPLE_PDF_URL,
            'format' => 'pdf',
            'places' => [['key' => 'client_signature', 'type' => 'signature', 'recipient_key' => 'client']],
            'fixed_positions' => [['place_key' => 'client_signature', 'page' => 1, 'top' => 172, 'left' => 210]],
        ]],
        'recipients' => [['key' => 'client', 'type' => 'signer', 'name' => $name, 'email' => $email]],
    ];
}

/** @return array{0: int, 1: string} status and body */
function http_request(string $method, string $url, array $headers = [], ?string $body = null): array
{
    $context = stream_context_create(['http' => [
        'method' => $method,
        'header' => implode("\r\n", $headers),
        'content' => $body ?? '',
        'ignore_errors' => true, // Return the body of 4xx and 5xx responses instead of failing.
        'timeout' => 30,
    ]]);
    $responseBody = @file_get_contents($url, false, $context);
    if ($responseBody === false) {
        throw new SignatureApiException("Could not reach {$url}");
    }
    preg_match('#HTTP/\S+ (\d{3})#', $http_response_header[0] ?? '', $m);
    return [(int) ($m[1] ?? 0), $responseBody];
}

function signatureapi_request(array $config, string $method, string $path, ?array $json = null): array
{
    $headers = ['X-API-Key: ' . $config['api_key'], 'Accept: application/json'];
    $body = null;
    if ($json !== null) {
        $headers[] = 'Content-Type: application/json';
        $body = json_encode($json, JSON_THROW_ON_ERROR);
    }
    [$status, $text] = http_request($method, $config['base_url'] . $path, $headers, $body);
    if ($status < 200 || $status > 299) {
        throw new SignatureApiException("SignatureAPI returned {$status}: {$text}", $status);
    }
    return json_decode($text, true, 512, JSON_THROW_ON_ERROR);
}

function send_envelope(array $config, string $name = 'Jane Doe', string $email = 'jane.doe@example.com'): array
{
    return signatureapi_request($config, 'POST', '/v1/envelopes', build_service_agreement($name, $email));
}

function get_envelope(array $config, string $envelopeId): array
{
    return signatureapi_request($config, 'GET', '/v1/envelopes/' . rawurlencode($envelopeId));
}

/** Saves the signed PDF of a completed envelope. @return array{0: string, 1: int} deliverable id and byte count */
function download_deliverable(array $config, string $envelopeId, string $outputPath): array
{
    $envelope = get_envelope($config, $envelopeId);
    if ($envelope['status'] !== 'completed') {
        throw new SignatureApiException("Envelope is {$envelope['status']}. The deliverable exists once the envelope is completed.");
    }
    if (empty($envelope['deliverable'])) {
        throw new SignatureApiException('The envelope has no deliverable yet. Try again in a few seconds.');
    }
    $deliverable = signatureapi_request($config, 'GET', '/v1/deliverables/' . rawurlencode($envelope['deliverable']['id']));
    if ($deliverable['status'] !== 'generated') {
        throw new SignatureApiException("Deliverable is {$deliverable['status']}. Try again once it is generated.");
    }
    // $deliverable['url'] is a pre-signed link that expires after 1 hour. Do not send the API key to it.
    [$status, $bytes] = http_request('GET', $deliverable['url']);
    if ($status !== 200) {
        throw new SignatureApiException("Download failed with {$status}");
    }
    file_put_contents($outputPath, $bytes);
    return [$deliverable['id'], strlen($bytes)];
}
