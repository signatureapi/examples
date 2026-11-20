#!/usr/bin/env bash
# Runs one example folder's tests the same way locally and in CI.
# Usage: bash .github/scripts/run-folder.sh <folder>      (from the repository root)
# Node and Python run on the host. Every other language runs in an official image pinned by digest,
# with the repository mounted at /repo. SIGNATUREAPI_KEY and SIGNATUREAPI_BASE_URL are passed by name
# (values stay in the environment); without SIGNATUREAPI_KEY the live tests skip.
set -euo pipefail

folder="${1:?usage: run-folder.sh <folder>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
[ -d "$folder" ] || { echo "no such folder: $folder" >&2; exit 2; }

PHP=php@sha256:628102249d93494233b54490b785f12db9cd60f4dc89416dfca15973f2125f10
RUBY=ruby@sha256:db3ad6dd68a886d51a187fb9bf486052f2976cdbe3b750169c25092aba1297fa
GO=golang@sha256:60deed95d3888cc5e4d9ff8a10c54e5edc008c6ae3fba6187be6fb592e19e8c0
JAVA=eclipse-temurin@sha256:db5cc6341a1d7bc40cdb51e1f0d9824f3bb2cc8107d29da421dc4df7d11f05f1
DOTNET=mcr.microsoft.com/dotnet/sdk@sha256:1b955f179b02df4f0eb5fadedaa898cbe44d620a64aab52eec72c8e91d1355b5
COMPOSER_SHA256=f446ea719708bb85fcbf4ef18def5d0515f1f9b4d703f6d820c9c1656e10a2f2

in_docker() { # image, shell command (runs in /repo/<folder>)
  docker run --rm -e SIGNATUREAPI_KEY -e SIGNATUREAPI_BASE_URL -e SIGNATUREAPI_WEBHOOK_SECRET \
    -v "$root":/repo -v signatureapi-examples-m2:/root/.m2 -w "/repo/$folder" "$1" sh -c "$2"
}

python_venv() { # installs requirements.txt into a local .venv, then runs the given command with it
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
  PATH="$PWD/.venv/bin:$PATH" "$@"
}

case "$folder" in
  scripts/node|scripts/upload-first|tutorials/node|collections|templates|use-cases/*|no-code/apps-script|no-code/airtable|no-code/pipedream|no-code/n8n|verify-webhooks/node)
    (cd "$folder" && node --test) ;;
  webhooks/express|webhooks/nextjs)
    (cd "$folder" && npm ci --no-audit --no-fund && npm test) ;;
  scripts/python)
    (cd "$folder" && python3 -m unittest discover -s tests -t .) ;;
  verify-webhooks/python)
    (cd "$folder" && python3 -m unittest -v) ;;
  tutorials/python-flask)
    (cd "$folder" && python_venv python -m unittest discover -s tests -t .) ;;
  tutorials/python-django)
    (cd "$folder" && python_venv python manage.py test -v 2) ;;
  webhooks/fastapi)
    (cd "$folder" && python_venv python -m unittest -v) ;;
  webhooks/django)
    (cd "$folder" && python_venv python manage.py test -v 2) ;;
  verify-webhooks/php) in_docker "$PHP" 'php test.php' ;;
  scripts/php) in_docker "$PHP" 'php test.php' ;;
  webhooks/laravel)
    in_docker "$PHP" "apt-get update -qq && apt-get install -y -qq unzip git >/dev/null \
      && php -r \"copy('https://getcomposer.org/download/2.8.12/composer.phar', '/tmp/composer.phar');\" \
      && echo '$COMPOSER_SHA256  /tmp/composer.phar' | sha256sum -c - \
      && php /tmp/composer.phar install --no-interaction --no-progress -q \
      && { [ -f .env ] || cp .env.example .env; } && php artisan key:generate -q && php artisan test" ;;
  tutorials/php-laravel)
    in_docker "$PHP" "apt-get update -qq && apt-get install -y -qq unzip git >/dev/null \
      && php -r \"copy('https://getcomposer.org/download/2.8.12/composer.phar', '/tmp/composer.phar');\" \
      && echo '$COMPOSER_SHA256  /tmp/composer.phar' | sha256sum -c - \
      && php /tmp/composer.phar install --no-interaction --no-progress -q \
      && { [ -f .env ] || cp .env.example .env; } && php artisan key:generate -q && php artisan test" ;;
  verify-webhooks/ruby) in_docker "$RUBY" 'ruby test_verify_webhook.rb' ;;
  scripts/ruby) in_docker "$RUBY" 'ruby test_scripts.rb' ;;
  webhooks/rails)
    in_docker "$RUBY" "apt-get update -qq && apt-get install -y -qq build-essential git libyaml-dev >/dev/null \
      && bundle config set --local path vendor/bundle && bundle install --quiet && bin/rails test" ;;
  tutorials/rails)
    in_docker "$RUBY" "apt-get update -qq && apt-get install -y -qq build-essential git libyaml-dev >/dev/null \
      && bundle config set --local path vendor/bundle && bundle install --quiet && bin/rails test" ;;
  verify-webhooks/go|scripts/go|tutorials/go) in_docker "$GO" 'go test -v ./...' ;;
  verify-webhooks/java) in_docker "$JAVA" 'javac -d out *.java && java -cp out VerifyTest' ;;
  scripts/java) in_docker "$JAVA" 'javac -d out *.java && java -cp out ScriptsTest' ;;
  webhooks/spring) in_docker "$JAVA" './mvnw -q test' ;;
  tutorials/java-spring) in_docker "$JAVA" './mvnw -q test' ;;
  verify-webhooks/csharp) in_docker "$DOTNET" 'dotnet run' ;;
  scripts/csharp) in_docker "$DOTNET" 'dotnet run --project Tests' ;;
  webhooks/aspnet) in_docker "$DOTNET" 'dotnet test' ;;
  tutorials/dotnet) in_docker "$DOTNET" 'dotnet test' ;;
  *) echo "no test recipe for $folder" >&2; exit 2 ;;
esac
