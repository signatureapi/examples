<?php

declare(strict_types=1);

final class WebhookVerificationError extends RuntimeException
{
}

/**
 * Verify a Standard Webhooks signature. Returns true or throws WebhookVerificationError.
 *
 * @param array<string, string> $headers Request headers (names matched case-insensitively).
 * @param string $rawBody The exact bytes received. Never a re-encoded JSON string.
 * @param int|null $now Unix seconds, defaults to the clock.
 */
function verifyWebhook(string $secret, array $headers, string $rawBody, ?int $now = null, int $toleranceSeconds = 300): bool
{
    $now ??= time();
    $lower = array_change_key_case($headers, CASE_LOWER);
    $id = $lower['webhook-id'] ?? '';
    $timestamp = $lower['webhook-timestamp'] ?? '';
    $signatureHeader = $lower['webhook-signature'] ?? '';
    if ($id === '' || $timestamp === '' || $signatureHeader === '') {
        throw new WebhookVerificationError('Missing webhook-id, webhook-timestamp or webhook-signature header');
    }
    if (!ctype_digit($timestamp)) {
        throw new WebhookVerificationError('Invalid webhook-timestamp');
    }
    if (abs($now - (int) $timestamp) > $toleranceSeconds) {
        throw new WebhookVerificationError('Timestamp outside the tolerance window');
    }

    $key = base64_decode(preg_replace('/^whsec_/', '', $secret), true);
    if ($key === false) {
        throw new WebhookVerificationError('Secret is not valid base64');
    }
    $expected = hash_hmac('sha256', "{$id}.{$timestamp}.{$rawBody}", $key, true);

    // The header holds space-separated "v1,<base64>" entries. Any match is enough.
    foreach (explode(' ', $signatureHeader) as $entry) {
        $parts = explode(',', $entry, 2);
        if (count($parts) !== 2 || $parts[0] !== 'v1') {
            continue;
        }
        $candidate = base64_decode($parts[1], true);
        if ($candidate !== false && hash_equals($expected, $candidate)) {
            return true;
        }
    }
    throw new WebhookVerificationError('No matching signature');
}
