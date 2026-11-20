<?php

namespace App\Providers;

use App\Support\SignatureApi;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(SignatureApi::class, fn () => SignatureApi::fromConfig());
    }

    public function boot(): void
    {
        // Fail fast when serving requests without a test key. Console commands (artisan, tests) skip it.
        if (!$this->app->runningInConsole()) {
            $this->app->make(SignatureApi::class);
        }
    }
}
