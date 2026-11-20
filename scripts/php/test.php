<?php

// Run with: php test.php
declare(strict_types=1);

require __DIR__ . '/signatureapi.php';

const ENVELOPE_ID = 'eb4cf433-a8af-4161-b37b-7ef57d423e56';
const DELIVERABLE_ID = 'del_5hN8sD2jKq7WxZ4mPv9Ta3';
const FAKE_KEY = 'key_test_fake';

$passed = $failed = $skipped = 0;

function check(string $name, bool $ok): void
{
    global $passed, $failed;
    $ok ? $passed++ : $failed++;
    echo ($ok ? 'ok   - ' : 'FAIL - ') . $name . "\n";
}

function throws(callable $fn, string $contains): bool
{
    try {
        $fn();
    } catch (SignatureApiException $e) {
        return str_contains($e->getMessage(), $contains);
    }
    return false;
}

// Config
check('config requires a key', throws(fn () => signatureapi_config([]), 'SIGNATUREAPI_KEY'));
check('config refuses live keys', throws(fn () => signatureapi_config(['SIGNATUREAPI_KEY' => 'key_live_x']), 'test mode only'));
check('config trims the base URL', signatureapi_config(['SIGNATUREAPI_KEY' => FAKE_KEY, 'SIGNATUREAPI_BASE_URL' => 'http://x/'])['base_url'] === 'http://x');

// Start the mock API with PHP's built-in server.
$log = tempnam(sys_get_temp_dir(), 'mock');
$port = random_int(20000, 40000);
$proc = proc_open(
    ['php', '-S', "127.0.0.1:{$port}", __DIR__ . '/mock_router.php'],
    [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']],
    $pipes,
    null,
    ['MOCK_LOG' => $log] + getenv(),
);
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) {
    usleep(100000);
}
$config = ['api_key' => FAKE_KEY, 'base_url' => "http://127.0.0.1:{$port}"];
$seen = fn () => array_map(fn ($l) => json_decode($l, true), array_filter(explode("\n", file_get_contents($log))));

try {
    $envelope = send_envelope($config);
    $req = $seen()[0];
    check('send: returns the envelope id', $envelope['id'] === ENVELOPE_ID);
    check('send: POST /v1/envelopes with the API key', [$req['method'], $req['path'], $req['key']] === ['POST', '/v1/envelopes', FAKE_KEY]);
    $expected = json_decode(file_get_contents(__DIR__ . '/expected-envelope.json'), true);
    check('send: body matches expected-envelope.json', $req['body'] == $expected);

    file_put_contents($log, '');
    $got = get_envelope($config, ENVELOPE_ID);
    $req = $seen()[0];
    check('get: GET /v1/envelopes/{id} with the API key', $got['status'] === 'completed' && [$req['method'], $req['path'], $req['key']] === ['GET', '/v1/envelopes/' . ENVELOPE_ID, FAKE_KEY]);

    file_put_contents($log, '');
    $out = tempnam(sys_get_temp_dir(), 'pdf');
    [$id, $size] = download_deliverable($config, ENVELOPE_ID, $out);
    $calls = array_map(fn ($r) => "{$r['method']} {$r['path']}", $seen());
    check('download: saves a PDF', $id === DELIVERABLE_ID && $size > 0 && str_starts_with(file_get_contents($out), '%PDF'));
    check('download: calls envelope, deliverable, then the signed URL', $calls === ['GET /v1/envelopes/' . ENVELOPE_ID, 'GET /v1/deliverables/' . DELIVERABLE_ID, 'GET /signed.pdf']);
    check('download: never sends the API key to the signed URL', $seen()[2]['key'] === null);

    $bad = ['api_key' => 'key_test_wrong'] + $config;
    check('401 raises SignatureApiException', throws(fn () => get_envelope($bad, ENVELOPE_ID), 'returned 401'));
} finally {
    proc_terminate($proc);
}

// Live test: runs only with a test key.
if ((getenv('SIGNATUREAPI_KEY') ?: '') === '') {
    $skipped++;
    echo "skip - live test: SIGNATUREAPI_KEY is not set\n";
} else {
    $live = signatureapi_config();
    $created = send_envelope($live);
    check('live: create and read back an envelope', get_envelope($live, $created['id'])['id'] === $created['id']);
}

echo "{$passed} passed, {$failed} failed, {$skipped} skipped\n";
exit($failed === 0 ? 0 : 1);
