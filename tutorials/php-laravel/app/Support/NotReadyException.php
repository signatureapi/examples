<?php

declare(strict_types=1);

namespace App\Support;

use RuntimeException;

/** The deliverable is not ready yet. The app answers 409 and the user tries again. */
final class NotReadyException extends RuntimeException
{
}
