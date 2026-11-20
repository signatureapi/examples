<?php

declare(strict_types=1);

require __DIR__ . '/verify.php';

$vector = json_decode(file_get_contents(__DIR__ . '/../test-vector.json'), true, 512, JSON_THROW_ON_ERROR);
$passed = 0;
$failed = 0;

function check(string $name, bool $ok, int &$passed, int &$failed): void
{
    if ($ok) {
        $passed++;
        echo "ok   - {$name}\n";
    } else {
        $failed++;
        echo "FAIL - {$name}\n";
    }
}

foreach ($vector['cases'] as $case) {
    try {
        $result = verifyWebhook($vector['secret'], $case['headers'], $case['body'], $vector['now'], $vector['tolerance_seconds']);
    } catch (WebhookVerificationError $e) {
        $result = false;
    }
    check("test vector: {$case['name']}", $result === ($case['expect'] === 'valid'), $passed, $failed);
}

$first = $vector['cases'][0];
$upper = array_change_key_case($first['headers'], CASE_UPPER);
check('header names are case-insensitive', verifyWebhook($vector['secret'], $upper, $first['body'], $vector['now']), $passed, $failed);

echo "{$passed} passed, {$failed} failed\n";
exit($failed === 0 ? 0 : 1);
