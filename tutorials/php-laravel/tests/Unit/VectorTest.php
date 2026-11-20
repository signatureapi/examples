<?php

namespace Tests\Unit;

use App\Support\WebhookVerificationException;
use App\Support\WebhookVerifier;
use PHPUnit\Framework\TestCase;

class VectorTest extends TestCase
{
    public function test_every_case_of_the_shared_vector(): void
    {
        $vector = json_decode(file_get_contents(__DIR__ . '/../../../../verify-webhooks/test-vector.json'), true);
        foreach ($vector['cases'] as $case) {
            $run = fn () => WebhookVerifier::verify($vector['secret'], $case['headers'], $case['body'], $vector['now']);
            if ($case['expect'] === 'valid') {
                $this->assertTrue($run(), $case['name']);
            } else {
                try {
                    $run();
                    $this->fail("{$case['name']} should be rejected");
                } catch (WebhookVerificationException) {
                    $this->addToAssertionCount(1);
                }
            }
        }
    }
}
