<?php

use App\Http\Controllers\WebhookController;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Support\Facades\Route;

// The sender cannot present a CSRF token. The signature is the authentication.
Route::post('/webhooks/signatureapi', [WebhookController::class, 'receive'])
    ->withoutMiddleware([PreventRequestForgery::class]);
