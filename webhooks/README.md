# SignatureAPI webhook endpoints by framework

A minimal, tested webhook endpoint for eight frameworks. Each one reads the raw body, verifies the Standard Webhooks signature, returns 2xx fast, skips duplicate `webhook-id`s and switches on `envelope.completed`, `recipient.completed` and `deliverable.generated`.

## What every example does

| Step | Why |
|---|---|
| Read the raw body | The signature covers the exact bytes. A parsed and re-serialized body never matches. |
| Verify, then parse | A forged request never reaches your logic. A bad signature returns `400`. |
| Deduplicate on `webhook-id` | Deliveries can repeat. The examples use memory (Laravel uses its cache). Production needs a shared store with an atomic insert. |
| Switch on the event type | Acknowledge unknown types with 2xx so they are not retried. |
| Return fast | Enqueue the work. SignatureAPI retries non-2xx responses for up to 48 hours. |

The signature function in each folder is a copy of the matching one in [`verify-webhooks`](../verify-webhooks), which explains the algorithm once.

## Pick your framework

| Framework | Language | Folder | Test command |
|---|---|---|---|
| Express | Node.js | [`express/`](express/README.md) | `npm ci && npm test` |
| Next.js | Node.js | [`nextjs/`](nextjs/README.md) | `npm ci && npm test` |
| FastAPI | Python | [`fastapi/`](fastapi/README.md) | `.venv/bin/python -m unittest -v` |
| Django | Python | [`django/`](django/README.md) | `.venv/bin/python manage.py test -v 2` |
| Laravel | PHP | [`laravel/`](laravel/README.md) | `php artisan test` |
| Rails | Ruby | [`rails/`](rails/README.md) | `bin/rails test` |
| Spring Boot | Java | [`spring/`](spring/README.md) | `./mvnw test` |
| ASP.NET Core | C# | [`aspnet/`](aspnet/README.md) | `dotnet test` |

Every test posts the `valid` case and the tampered cases from the shared [`test-vector.json`](../verify-webhooks/test-vector.json) to the app (or the framework's test client) and asserts 2xx versus 4xx. The tests freeze the clock at the vector's `now`, so the 5 minute tolerance check is deterministic.

## Try it with real events

```bash
npx signatureapi listen --forward-to http://127.0.0.1:3000/webhooks/signatureapi
npx signatureapi trigger envelope.completed
```

## Learn more

- [Webhooks](https://signatureapi.com/docs/api/webhooks)
- [Set up webhooks](https://signatureapi.com/docs/api/guides/how-to/set-up-webhooks)
- [Test webhooks with the CLI](https://signatureapi.com/docs/cli/webhooks)
