<?php

// Usage: SIGNATUREAPI_WEBHOOK_SECRET=whsec_... php verify-cli.php [delivery.json]
// Without an argument it checks the valid case from the shared test vector.
declare(strict_types=1);

require __DIR__ . '/verify.php';

$vector = json_decode(file_get_contents(__DIR__ . '/../test-vector.json'), true, 512, JSON_THROW_ON_ERROR);
if (isset($argv[1])) {
    $delivery = json_decode(file_get_contents($argv[1]), true, 512, JSON_THROW_ON_ERROR);
    $now = null;
} else {
    $delivery = $vector['cases'][0];
    $now = $vector['now'];
}
$secret = getenv('SIGNATUREAPI_WEBHOOK_SECRET') ?: $vector['secret'];

try {
    verifyWebhook($secret, $delivery['headers'], $delivery['body'], $now);
    echo "valid signature\n";
} catch (WebhookVerificationError $e) {
    fwrite(STDERR, "invalid: {$e->getMessage()}\n");
    exit(1);
}
