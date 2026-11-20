# End-to-end e-signature tutorials

Complete apps that combine the three parts of a production integration: create the envelope on your server, let the user sign inside your page (embedded ceremony), and track the outcome with verified webhooks.

| Stack | Folder | What it shows |
|---|---|---|
| Node.js (no dependencies) | [`node/`](node) | `node:http` server, embedded iframe, Standard Webhooks verification, idempotent handler |
| Python and Flask | [`python-flask/`](python-flask) | Flask app with the same flow, raw-body verification with `request.get_data()` |
| PHP and Laravel | [`php-laravel/`](php-laravel) | Laravel app with the same flow, `Http` client, raw-body verification with `$request->getContent()`, CSRF-excluded webhook route |
| Ruby on Rails | [`rails/`](rails) | API-only Rails app with the same flow, raw-body verification with `request.raw_post`, webhook events recorded by an Active Job |
| Python and Django | [`python-django/`](python-django) | Django project with the same flow, raw-body verification with `request.body`, CSRF-exempt webhook view |
| Go (standard library) | [`go/`](go) | `net/http` server, embedded `index.html`, raw-body verification with `io.ReadAll` |
| Java and Spring Boot | [`java-spring/`](java-spring) | Spring Boot app with the same flow, `java.net.http` client, raw-body verification with `@RequestBody byte[]` |
| C# and ASP.NET Core | [`dotnet/`](dotnet) | Minimal API app with the same flow, `HttpClient`, raw-body verification from `Request.Body`, xunit tests |

Each app runs against a local mock API in its tests, so you can read and run it before you have an API key. With a test key, the live tests create a real test-mode envelope.

For webhook handlers in other frameworks (Express, FastAPI, Django, Laravel, Rails, Spring, ASP.NET, Next.js), see [`webhooks/`](../webhooks).
