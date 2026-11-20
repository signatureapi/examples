<?php

namespace App\Http\Controllers;

use App\Support\WebhookVerificationException;
use App\Support\WebhookVerifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class WebhookController extends Controller
{
    // Step 3: SignatureAPI calls this endpoint. Verify the RAW body (getContent), never re-encoded JSON.
    public function receive(Request $request): JsonResponse
    {
        $rawBody = $request->getContent();
        $webhookId = (string) $request->header('webhook-id');

        try {
            WebhookVerifier::verify(
                (string) config('services.signatureapi.webhook_secret'),
                [
                    'webhook-id' => $webhookId,
                    'webhook-timestamp' => $request->header('webhook-timestamp'),
                    'webhook-signature' => $request->header('webhook-signature'),
                ],
                $rawBody,
                time(),
            );
        } catch (WebhookVerificationException $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        }

        // Retries repeat the same webhook-id for up to 48 hours. Cache::add stores the key only if it is absent.
        // In production these live in your database.
        if (!Cache::add("signatureapi-webhook:{$webhookId}", true, now()->addDays(3))) {
            return response()->json(['duplicate' => true]);
        }

        $event = json_decode($rawBody, true, 512, JSON_THROW_ON_ERROR);
        $envelopeId = $event['data']['envelope_id'] ?? null;
        $record = Cache::get("contract:{$envelopeId}", ['status' => 'unknown', 'events' => []]);
        $record['events'][] = $event['type'];
        if ($event['type'] === 'envelope.completed') {
            $record['status'] = 'completed';
        }
        Cache::put("contract:{$envelopeId}", $record, now()->addDays(3));
        Log::info("webhook {$event['type']} for envelope {$envelopeId}");

        return response()->json(['received' => true]);
    }
}
