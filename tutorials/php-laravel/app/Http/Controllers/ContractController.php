<?php

namespace App\Http\Controllers;

use App\Support\NotReadyException;
use App\Support\SignatureApi;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

class ContractController extends Controller
{
    // Step 1: your server creates the envelope and hands the ceremony URL to the browser.
    public function store(Request $request, SignatureApi $signatureApi): JsonResponse
    {
        $name = $request->input('name');
        $email = $request->input('email');
        if (!$name || !$email) {
            return response()->json(['error' => 'name and email are required'], 422);
        }
        $userId = 'usr_' . Str::random(8); // your signed-in user's id
        $session = $signatureApi->createSigningSession($name, $email, $userId);
        // In production these live in your database.
        Cache::put("contract:{$session['envelopeId']}", ['status' => 'in_progress', 'events' => []], now()->addDay());

        return response()->json($session, 201);
    }

    // Step 4: confirm the real state on the server before acting on a browser event.
    public function show(string $id, SignatureApi $signatureApi): JsonResponse
    {
        $envelope = $signatureApi->api('GET', "/v1/envelopes/{$id}");

        return response()->json([
            'envelopeId' => $envelope['id'],
            'status' => $envelope['status'],
            'webhookEvents' => Cache::get("contract:{$envelope['id']}")['events'] ?? [],
        ]);
    }

    // Step 5: stream the signed PDF through your server, so the browser never needs your API key.
    public function signedPdf(string $id, SignatureApi $signatureApi)
    {
        try {
            $pdf = $signatureApi->downloadSignedPdf($id);
        } catch (NotReadyException $e) {
            return response()->json(['error' => $e->getMessage()], 409);
        }

        return response($pdf, 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="signed-service-agreement.pdf"',
        ]);
    }
}
