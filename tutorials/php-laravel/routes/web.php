<?php

use App\Http\Controllers\ContractController;
use App\Http\Controllers\WebhookController;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Support\Facades\Route;

Route::view('/', 'index');

// The browser calls these with fetch and no CSRF token, and the webhook sender cannot present one
// (its signature is the authentication). Your own app would put the JSON routes behind its login.
Route::withoutMiddleware([PreventRequestForgery::class])->group(function () {
    Route::post('/api/contracts', [ContractController::class, 'store']);
    Route::get('/api/contracts/{id}', [ContractController::class, 'show'])->whereUuid('id');
    Route::get('/api/contracts/{id}/signed.pdf', [ContractController::class, 'signedPdf'])->whereUuid('id');
    Route::post('/webhooks/signatureapi', [WebhookController::class, 'receive']);
});
