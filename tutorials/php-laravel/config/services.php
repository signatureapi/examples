<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'signatureapi' => [
        'webhook_secret' => env('SIGNATUREAPI_WEBHOOK_SECRET'),
    ],

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'signatureapi' => [
        'key' => env('SIGNATUREAPI_KEY'),
        'base_url' => rtrim(env('SIGNATUREAPI_BASE_URL') ?: 'https://api.signatureapi.com', '/'),
        'webhook_secret' => env('SIGNATUREAPI_WEBHOOK_SECRET', ''),
        'app_origin' => env('APP_ORIGIN', 'http://localhost:8000'),
    ],

];
