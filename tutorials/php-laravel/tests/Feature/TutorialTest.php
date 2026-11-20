<?php

namespace Tests\Feature;

use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class TutorialTest extends TestCase
{
    private const ENVELOPE_ID = 'eb4cf433-a8af-4161-b37b-7ef57d423e56';
    private const DELIVERABLE_ID = 'del_5hN8sD2jKq7WxZ4mPv9Ta3';
    private const NEW_ENVELOPE_ID = '688d2c9f-5dbe-4bc4-bd0b-2e0459016be8';
    private const API = 'https://api.mock.test';

    private array $vector;
    private string $fakeKey;

    protected function setUp(): void
    {
        parent::setUp();
        $this->vector = json_decode(file_get_contents(base_path('../../verify-webhooks/test-vector.json')), true);
        $this->fakeKey = implode('_', ['key', 'test', 'offline']);
        config(['services.signatureapi' => [
            'key' => $this->fakeKey,
            'base_url' => self::API,
            'webhook_secret' => $this->vector['secret'],
            'app_origin' => 'https://app.acme.example',
        ]]);
        Cache::flush();
        // The mock API: the deliverable URL is pre-signed, so /files/signed.pdf needs no API key.
        Http::fake([
            self::API . '/v1/envelopes' => Http::response([
                'id' => self::NEW_ENVELOPE_ID, 'status' => 'processing', 'recipients' => [['ceremony' => ['url' => null]]],
            ], 201),
            self::API . '/v1/envelopes/' . self::NEW_ENVELOPE_ID => Http::response([
                'id' => self::NEW_ENVELOPE_ID, 'status' => 'in_progress',
                'recipients' => [['ceremony' => ['url' => 'https://sign.signatureapi.com/en/start?token=mock']]],
            ]),
            self::API . '/v1/envelopes/' . self::ENVELOPE_ID => Http::response([
                'id' => self::ENVELOPE_ID, 'status' => 'completed', 'deliverable' => ['id' => self::DELIVERABLE_ID],
            ]),
            self::API . '/v1/deliverables/' . self::DELIVERABLE_ID => Http::response([
                'id' => self::DELIVERABLE_ID, 'status' => 'generated', 'url' => self::API . '/files/signed.pdf',
            ]),
            self::API . '/files/signed.pdf' => Http::response('%PDF-1.7 mock', 200, ['Content-Type' => 'application/pdf']),
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_page_checks_origin(): void
    {
        $this->get('/')->assertOk()->assertSee('event.origin !== CEREMONY_ORIGIN', false);
    }

    public function test_create_contract(): void
    {
        $response = $this->postJson('/api/contracts', ['name' => 'Jane Doe', 'email' => 'jane.doe@example.com']);
        $response->assertStatus(201)->assertJsonPath('envelopeId', self::NEW_ENVELOPE_ID)
            ->assertJsonPath('ceremonyUrl', 'https://sign.signatureapi.com/en/start?token=mock');

        Http::assertSent(function (ClientRequest $request) {
            if ($request->method() !== 'POST' || !str_ends_with($request->url(), '/v1/envelopes')) {
                return false;
            }
            $recipient = $request['recipients'][0];

            return $request->header('X-API-Key') === [$this->fakeKey]
                && $recipient['delivery_type'] === 'none'
                && $recipient['ceremony']['embeddable_in'] === ['https://app.acme.example']
                && $recipient['ceremony']['authentication'][0]['type'] === 'custom';
        });
    }

    public function test_create_requires_fields(): void
    {
        $this->postJson('/api/contracts', [])->assertStatus(422);
    }

    public function test_webhook_flow(): void
    {
        $valid = collect($this->vector['cases'])->firstWhere('name', 'valid');
        $tampered = collect($this->vector['cases'])->firstWhere('name', 'tampered_body');
        $timestamp = (string) time();
        $id = $valid['headers']['webhook-id'];
        $key = base64_decode(preg_replace('/^whsec_/', '', $this->vector['secret']));
        $signature = 'v1,' . base64_encode(hash_hmac('sha256', "{$id}.{$timestamp}.{$valid['body']}", $key, true));
        $headers = ['webhook-id' => $id, 'webhook-timestamp' => $timestamp, 'webhook-signature' => $signature];

        $this->deliver($valid['body'], $headers)->assertOk()->assertExactJson(['received' => true]);
        $this->deliver($valid['body'], $headers)->assertOk()->assertExactJson(['duplicate' => true]);
        $this->deliver($tampered['body'], [...$headers, 'webhook-id' => 'msg_other'])->assertStatus(400);

        $this->getJson('/api/contracts/' . self::ENVELOPE_ID)->assertJsonPath('webhookEvents', ['envelope.completed']);
    }

    public function test_signed_pdf(): void
    {
        $response = $this->get('/api/contracts/' . self::ENVELOPE_ID . '/signed.pdf');
        $response->assertOk()->assertHeader('Content-Type', 'application/pdf');
        $this->assertStringContainsString('attachment; filename="signed-service-agreement.pdf"', $response->headers->get('Content-Disposition'));
        $this->assertStringStartsWith('%PDF', $response->getContent());
        // The pre-signed file URL must be fetched without the API key.
        Http::assertSent(fn (ClientRequest $request) => str_ends_with($request->url(), '/files/signed.pdf') && !$request->hasHeader('X-API-Key'));
    }

    private function deliver(string $body, array $headers)
    {
        $server = ['CONTENT_TYPE' => 'application/json'];
        foreach ($headers as $name => $value) {
            $server['HTTP_' . strtoupper(str_replace('-', '_', $name))] = $value;
        }

        // call() with a string body sends the bytes untouched. postJson() would encode an array again.
        return $this->call('POST', '/webhooks/signatureapi', [], [], [], $server, $body);
    }
}
