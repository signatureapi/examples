<?php

namespace Tests\Feature;

use App\Support\ApiException;
use App\Support\NotReadyException;
use App\Support\SignatureApi;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

// Live tests: set SIGNATUREAPI_KEY to a test key. Without it they skip.
class LiveTest extends TestCase
{
    private SignatureApi $signatureApi;

    protected function setUp(): void
    {
        parent::setUp();
        if (!getenv('SIGNATUREAPI_KEY')) {
            $this->markTestSkipped('live test: set SIGNATUREAPI_KEY to a test key');
        }
        $this->signatureApi = new SignatureApi(
            getenv('SIGNATUREAPI_KEY'),
            rtrim(getenv('SIGNATUREAPI_BASE_URL') ?: 'https://api.signatureapi.com', '/'),
            'https://app.acme.example',
        );
    }

    public function test_create_embedded_envelope(): void
    {
        $session = $this->signatureApi->createSigningSession('Jane Doe', 'jane.doe@example.com', 'usr_tutorial');
        $this->assertMatchesRegularExpression('/^[0-9a-f-]{36}$/', $session['envelopeId']);
        // Never print the ceremony URL: it is a bearer link for the signer.
        $this->assertStringStartsWith('https://', $session['ceremonyUrl']);
    }

    // An automatic signer completes the envelope without a person, so the download step runs for real.
    public function test_download_signed_pdf(): void
    {
        $png = file_get_contents(__DIR__ . '/../../../../scripts/assets/acme-mark.png');
        $upload = Http::withHeaders(['X-API-Key' => getenv('SIGNATUREAPI_KEY')])
            ->withBody($png, 'image/png')
            ->post(rtrim(getenv('SIGNATUREAPI_BASE_URL') ?: 'https://api.signatureapi.com', '/') . '/v1/uploads');
        $this->assertSame(201, $upload->status());

        $body = $this->signatureApi->buildContract('Jane Doe', 'jane.doe@example.com', 'usr_tutorial');
        $body['recipients'] = [[
            'key' => 'client', 'type' => 'automatic_signer', 'name' => 'Jane Doe',
            'signature' => ['type' => 'drawn', 'url' => $upload->json('url')],
            'mandate' => 'Authorized by Acme Corp board resolution 2026-04 (synthetic example)',
        ]];
        $created = $this->signatureApi->api('POST', '/v1/envelopes', $body);

        $pdf = null;
        for ($i = 0; $i < 60 && $pdf === null; $i++) {
            sleep(2);
            try {
                $pdf = $this->signatureApi->downloadSignedPdf($created['id']);
            } catch (NotReadyException) {
                continue;
            }
        }
        $this->assertNotNull($pdf, 'the signed PDF was not ready within 120 seconds');
        $this->assertStringStartsWith('%PDF', $pdf);
    }
}
