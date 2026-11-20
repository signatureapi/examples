<?php

namespace App\Http\Controllers;

use App\Support\WebhookVerificationException;
use App\Support\WebhookVerifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class WebhookController extends Controller
{
    public function receive(Request $request): JsonResponse
    {
        // getContent() is the body exactly as received. $request->all() or json() would be parsed,
        // and re-encoding them does not give the bytes that were signed.
        $rawBody = $request->getContent();

        try {
            WebhookVerifier::verify(
                (string) config('services.signatureapi.webhook_secret'),
                [
                    'webhook-id' => $request->header('webhook-id'),
                    'webhook-timestamp' => $request->header('webhook-timestamp'),
                    'webhook-signature' => $request->header('webhook-signature'),
                ],
                $rawBody,
                Carbon::now()->getTimestamp(),
            );
        } catch (WebhookVerificationException $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        }

        // Cache::add stores the key only if it is absent, atomically. With the Redis or database cache
        // driver this dedupes across servers; the array driver used in tests lives for one process.
        if (!Cache::add('signatureapi-webhook:' . $request->header('webhook-id'), true, now()->addDay())) {
            return response()->json(['status' => 'duplicate']);
        }

        $event = json_decode($rawBody, true, 512, JSON_THROW_ON_ERROR);
        switch ($event['type']) {
            case 'envelope.completed':
                Log::info("envelope {$event['data']['envelope_id']} completed");
                break;
            case 'recipient.completed':
                Log::info("recipient {$event['data']['object_id']} completed");
                break;
            case 'deliverable.generated':
                Log::info("deliverable {$event['data']['object_id']} is ready");
                break;
            default:
                break; // Acknowledge event types you do not handle so they are not retried.
        }

        // Respond fast. Hand slow work to a queued job (dispatch(new ProcessEnvelope(...))).
        return response()->json(['status' => 'ok']);
    }
}
