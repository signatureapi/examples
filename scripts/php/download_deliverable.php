<?php

// Download the signed PDF (deliverable) of a completed envelope.
// Usage: php download_deliverable.php <envelope-id> [output.pdf]
declare(strict_types=1);

require __DIR__ . '/signatureapi.php';

if (!isset($argv[1])) {
    fwrite(STDERR, "Usage: php download_deliverable.php <envelope-id> [output.pdf]\n");
    exit(1);
}
$output = $argv[2] ?? 'signed-envelope.pdf';
try {
    [$id, $size] = download_deliverable(signatureapi_config(), $argv[1], $output);
    echo "Saved deliverable {$id} to {$output} ({$size} bytes)\n";
} catch (SignatureApiException $e) {
    fwrite(STDERR, "Error: {$e->getMessage()}\n");
    exit(1);
}
