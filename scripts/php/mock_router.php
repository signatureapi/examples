<?php

// Router script for `php -S`: a local mock of the SignatureAPI endpoints the scripts call.
// It appends every request to the file named by MOCK_LOG so the test can assert on them.
$envelopeId = 'eb4cf433-a8af-4161-b37b-7ef57d423e56';
$deliverableId = 'del_5hN8sD2jKq7WxZ4mPv9Ta3';
$fakeKey = 'key_test_fake';

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$key = $_SERVER['HTTP_X_API_KEY'] ?? null;
$raw = file_get_contents('php://input');
file_put_contents(getenv('MOCK_LOG'), json_encode([
    'method' => $method, 'path' => $path, 'key' => $key, 'body' => $raw === '' ? null : json_decode($raw, true),
]) . "\n", FILE_APPEND);

function reply(int $status, mixed $body, string $type = 'application/json'): void
{
    http_response_code($status);
    header("Content-Type: {$type}");
    echo is_string($body) ? $body : json_encode($body);
}

if ($path === '/signed.pdf') {
    $key !== null ? reply(400, 'key leaked', 'text/plain') : reply(200, '%PDF-1.4 mock', 'application/pdf');
} elseif ($key !== $fakeKey) {
    reply(401, ['title' => 'Unauthorized']);
} elseif ($method === 'POST' && $path === '/v1/envelopes') {
    reply(201, ['id' => $envelopeId, 'status' => 'processing', 'recipients' => [
        ['key' => 'client', 'type' => 'signer', 'name' => 'Jane Doe', 'email' => 'jane.doe@example.com', 'status' => 'pending'],
    ]]);
} elseif ($method === 'GET' && $path === "/v1/envelopes/{$envelopeId}") {
    reply(200, ['id' => $envelopeId, 'status' => 'completed', 'recipients' => [], 'deliverable' => ['id' => $deliverableId, 'status' => 'generated']]);
} elseif ($method === 'GET' && $path === "/v1/deliverables/{$deliverableId}") {
    reply(200, ['id' => $deliverableId, 'status' => 'generated', 'url' => "http://{$_SERVER['HTTP_HOST']}/signed.pdf"]);
} else {
    reply(404, ['title' => 'Not Found']);
}
