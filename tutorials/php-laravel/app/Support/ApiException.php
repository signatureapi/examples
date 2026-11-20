<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Http\JsonResponse;
use RuntimeException;

/** SignatureAPI answered with an error. The app passes it on as 502. */
final class ApiException extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 0)
    {
        parent::__construct($message);
    }

    public function render(): JsonResponse
    {
        return response()->json(['error' => $this->getMessage()], 502);
    }
}
