<?php

// Print the status of an envelope and each of its recipients.
// Usage: php get_status.php <envelope-id>
declare(strict_types=1);

require __DIR__ . '/signatureapi.php';

if (!isset($argv[1])) {
    fwrite(STDERR, "Usage: php get_status.php <envelope-id>\n");
    exit(1);
}
try {
    $envelope = get_envelope(signatureapi_config(), $argv[1]);
    echo "Envelope {$envelope['id']}: {$envelope['status']}\n";
    foreach ($envelope['recipients'] as $r) {
        echo "  {$r['key']} ({$r['type']}): {$r['status']}\n";
    }
    if (!empty($envelope['deliverable'])) {
        echo "Deliverable {$envelope['deliverable']['id']}: {$envelope['deliverable']['status']}\n";
    }
} catch (SignatureApiException $e) {
    fwrite(STDERR, "Error: {$e->getMessage()}\n");
    exit(1);
}
