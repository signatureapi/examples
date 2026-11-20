<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\Http;
use InvalidArgumentException;

/** SignatureAPI client and envelope builder for the Laravel tutorial. */
final class SignatureApi
{
    public function __construct(
        private readonly string $key,
        private readonly string $baseUrl = 'https://api.signatureapi.com',
        public readonly string $appOrigin = 'http://localhost:8000',
    ) {
        if (!str_starts_with($key, 'key_test_')) {
            throw new InvalidArgumentException('Set SIGNATUREAPI_KEY to a test API key (it starts with key_test_).');
        }
    }

    public static function fromConfig(): self
    {
        $config = config('services.signatureapi');

        return new self((string) $config['key'], $config['base_url'], $config['app_origin']);
    }

    /** Calls the API and returns the decoded JSON. Throws ApiException on a non-2xx answer. */
    public function api(string $method, string $path, ?array $body = null): array
    {
        $response = Http::withHeaders(['X-API-Key' => $this->key])
            ->acceptJson()
            ->timeout(60)
            ->send($method, $this->baseUrl . $path, $body === null ? [] : ['json' => $body]);
        if ($response->failed()) {
            $detail = (string) ($response->json('detail') ?? $response->json('title'));
            throw new ApiException("SignatureAPI returned {$response->status()}" . ($detail !== '' ? ": {$detail}" : ''), $response->status());
        }

        return $response->json() ?? [];
    }

    /** Envelope for an embedded ceremony: custom authentication, embeddable_in, no email delivery. */
    public function buildContract(string $name, string $email, string $userId): array
    {
        return [
            'title' => 'Service Agreement',
            'metadata' => ['app_user_id' => $userId],
            'documents' => [[
                'url' => 'https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf',
                'format' => 'pdf',
                'places' => [['key' => 'client_signature', 'type' => 'signature', 'recipient_key' => 'client']],
                'fixed_positions' => [['place_key' => 'client_signature', 'page' => 1, 'top' => 172, 'left' => 210]],
            ]],
            'recipients' => [[
                'key' => 'client',
                'type' => 'signer',
                'name' => $name,
                'email' => $email,
                'delivery_type' => 'none',
                'ceremony' => [
                    'authentication' => [['type' => 'custom', 'provider' => 'Acme Corp Portal', 'data' => ['user_id' => $userId]]],
                    'embeddable_in' => [$this->appOrigin],
                ],
            ]],
        ];
    }

    /**
     * Creates the envelope and waits until it is in_progress: the ceremony opens only after the
     * envelope leaves `processing`. Each read returns a fresh ceremony URL for the same ceremony.
     *
     * @return array{envelopeId: string, ceremonyUrl: string}
     */
    public function createSigningSession(string $name, string $email, string $userId): array
    {
        $envelope = $this->api('POST', '/v1/envelopes', $this->buildContract($name, $email, $userId));
        for ($attempt = 0; $envelope['status'] === 'processing' && $attempt < 30; $attempt++) {
            sleep(1);
            $envelope = $this->api('GET', "/v1/envelopes/{$envelope['id']}");
        }
        if ($envelope['status'] !== 'in_progress') {
            throw new ApiException("Envelope is {$envelope['status']}, not ready for signing");
        }

        return ['envelopeId' => $envelope['id'], 'ceremonyUrl' => $envelope['recipients'][0]['ceremony']['url']];
    }

    /**
     * Downloads the signed PDF of a completed envelope.
     *
     * The deliverable URL is pre-signed and expires after 1 hour, so fetch a fresh one each time
     * instead of storing it. It needs no API key.
     */
    public function downloadSignedPdf(string $envelopeId): string
    {
        $envelope = $this->api('GET', "/v1/envelopes/{$envelopeId}");
        if ($envelope['status'] !== 'completed' || empty($envelope['deliverable'])) {
            throw new NotReadyException("Envelope is {$envelope['status']}. The signed PDF exists once it is completed.");
        }
        $deliverable = $this->api('GET', "/v1/deliverables/{$envelope['deliverable']['id']}");
        if ($deliverable['status'] !== 'generated') {
            throw new NotReadyException("Deliverable is {$deliverable['status']}. Try again in a few seconds.");
        }

        return Http::timeout(60)->get($deliverable['url'])->throw()->body();
    }
}
