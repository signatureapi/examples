<?php

namespace Tests\Feature;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class WebhookTest extends TestCase
{
    private array $vector;

    protected function setUp(): void
    {
        parent::setUp();
        $this->vector = json_decode(file_get_contents(base_path('../../verify-webhooks/test-vector.json')), true);
        config(['services.signatureapi.webhook_secret' => $this->vector['secret']]);
        // Freeze the clock at the vector's "now" so the 5 minute tolerance is deterministic.
        Carbon::setTestNow(Carbon::createFromTimestamp($this->vector['now']));
        Cache::flush();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function deliver(string $name)
    {
        $case = collect($this->vector['cases'])->firstWhere('name', $name);
        $server = ['CONTENT_TYPE' => 'application/json'];
        foreach ($case['headers'] as $header => $value) {
            $server['HTTP_' . strtoupper(str_replace('-', '_', $header))] = $value;
        }

        // call() with a string body sends the bytes untouched. postJson() would encode an array again.
        return $this->call('POST', '/webhooks/signatureapi', [], [], [], $server, $case['body']);
    }

    public function test_valid_delivery_returns_2xx(): void
    {
        $this->deliver('valid')->assertOk();
    }

    public function test_a_repeated_webhook_id_is_acknowledged_as_a_duplicate(): void
    {
        $this->deliver('valid')->assertOk();
        $this->deliver('valid')->assertOk()->assertJson(['status' => 'duplicate']);
    }

    public function test_tampered_body_returns_4xx(): void
    {
        $this->deliver('tampered_body')->assertStatus(400);
    }

    public function test_wrong_secret_returns_4xx(): void
    {
        $this->deliver('wrong_secret_signature')->assertStatus(400);
    }

    public function test_missing_headers_return_4xx(): void
    {
        $this->deliver('missing_headers')->assertStatus(400);
    }
}
