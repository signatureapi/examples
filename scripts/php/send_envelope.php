<?php

// Send the sample Service Agreement to one signer.
// Usage: php send_envelope.php [name] [email]
declare(strict_types=1);

require __DIR__ . '/signatureapi.php';

try {
    $envelope = isset($argv[2])
        ? send_envelope(signatureapi_config(), $argv[1], $argv[2])
        : send_envelope(signatureapi_config());
    echo "Envelope created: {$envelope['id']}\n";
    echo "Status: {$envelope['status']}\n";
    foreach ($envelope['recipients'] as $r) {
        echo "Recipient {$r['key']}: {$r['name']} <{$r['email']}> ({$r['status']})\n";
    }
} catch (SignatureApiException $e) {
    fwrite(STDERR, "Error: {$e->getMessage()}\n");
    exit(1);
}
