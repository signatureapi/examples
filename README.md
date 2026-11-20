# SignatureAPI examples

Runnable, tested code for the [SignatureAPI](https://signatureapi.com) e-signature API. Send documents for signature, embed the signing ceremony in your app, verify webhooks, and download signed PDFs, in Node.js, Python, PHP, Ruby, Go, Java and C#.

Every folder is a small, self-contained project with a step-by-step README and its own tests. Offline tests run against a local mock API, so you can read and run the code before you have an API key. With a free test key, the live tests create real test-mode envelopes.

## Contents

- [Quick start](#quick-start)
- [Scripts: send, track, download](#scripts-send-track-download)
- [Webhooks](#webhooks)
- [Tutorials: complete apps](#tutorials-complete-apps)
- [DOCX templates](#docx-templates)
- [Use cases by industry](#use-cases-by-industry)
- [No-code and low-code platforms](#no-code-and-low-code-platforms)
- [API collections](#api-collections)
- [How the examples are tested](#how-the-examples-are-tested)
- [Conventions](#conventions)

## Quick start

1. [Sign up](https://accounts.signatureapi.com/sign-up) and copy your test API key from the dashboard. It starts with `key_test_`. Test envelopes are free and have no legal effect.
2. Send your first envelope with Node.js (no install needed):

   ```bash
   git clone https://github.com/signatureapi/examples.git
   cd examples/scripts/node
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   node send-envelope.mjs "Jane Doe" jane.doe@example.com
   ```

3. Open the envelope in the [dashboard](https://dashboard.signatureapi.com), preview the email, and sign as Jane. Then download the signed PDF:

   ```bash
   node download-deliverable.mjs <envelope-id> signed.pdf
   ```

New to the API? Read the [quickstart](https://signatureapi.com/docs/api/guides/quickstart) and the [core concepts](https://signatureapi.com/docs/api/concepts): an **envelope** holds **documents** and **recipients**, each recipient signs in a **ceremony**, and a completed envelope produces a **deliverable** with the signed documents and the audit log.

## Scripts: send, track, download

Dependency-free scripts that send a document for signature, check the status, and download the signed PDF. [`scripts/`](scripts)

| Language | Folder |
|---|---|
| Node.js | [`scripts/node`](scripts/node) (also bulk send from CSV) |
| Python | [`scripts/python`](scripts/python) (also bulk send from CSV) |
| PHP | [`scripts/php`](scripts/php) |
| Ruby | [`scripts/ruby`](scripts/ruby) |
| Go | [`scripts/go`](scripts/go) |
| Java | [`scripts/java`](scripts/java) |
| C# | [`scripts/csharp`](scripts/csharp) |

Bring your own file: [`scripts/upload-first`](scripts/upload-first) uploads a local PDF or DOCX, then sends it.

## Webhooks

SignatureAPI signs webhook deliveries with the [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks) scheme. Every example is checked against one shared [test vector](verify-webhooks/test-vector.json).

**Verify a signature** with the standard library only: [`verify-webhooks/`](verify-webhooks) in
[Node.js](verify-webhooks/node), [Python](verify-webhooks/python), [PHP](verify-webhooks/php), [Ruby](verify-webhooks/ruby), [Go](verify-webhooks/go), [Java](verify-webhooks/java) and [C#](verify-webhooks/csharp).

**Receive webhooks in your framework**, with raw-body verification, duplicate handling and event routing: [`webhooks/`](webhooks)

| Framework | Folder |
|---|---|
| Express | [`webhooks/express`](webhooks/express) |
| Next.js route handler | [`webhooks/nextjs`](webhooks/nextjs) |
| FastAPI | [`webhooks/fastapi`](webhooks/fastapi) |
| Django | [`webhooks/django`](webhooks/django) |
| Laravel | [`webhooks/laravel`](webhooks/laravel) |
| Ruby on Rails | [`webhooks/rails`](webhooks/rails) |
| Spring Boot | [`webhooks/spring`](webhooks/spring) |
| ASP.NET Core | [`webhooks/aspnet`](webhooks/aspnet) |

## Tutorials: complete apps

End-to-end apps that create an envelope on the server, embed the signing ceremony in the page, and track the result with verified webhooks. [`tutorials/`](tutorials)

| Stack | Folder |
|---|---|
| Node.js (no dependencies) | [`tutorials/node`](tutorials/node) |
| Python and Flask | [`tutorials/python-flask`](tutorials/python-flask) |
| Python and Django | [`tutorials/python-django`](tutorials/python-django) |
| PHP and Laravel | [`tutorials/php-laravel`](tutorials/php-laravel) |
| Ruby on Rails | [`tutorials/rails`](tutorials/rails) |
| Go (standard library) | [`tutorials/go`](tutorials/go) |
| Java and Spring Boot | [`tutorials/java-spring`](tutorials/java-spring) |
| C# and ASP.NET Core | [`tutorials/dotnet`](tutorials/dotnet) |

Each app waits until the envelope is `in_progress` before it opens the ceremony, and streams the signed PDF through your server only once the deliverable is `generated`.

## DOCX templates

Twelve DOCX templates with merge fields and signature placeholders, written as fictional text for Acme Corp: offer letter, mutual NDA, employment contract, contractor agreement, master services agreement, statement of work with line items, residential lease, purchase agreement, medical consent, liability waiver, permission slip and change order. Each folder has the template, sample data and the envelope's recipients and places. One zero-dependency script uploads a template and sends it in test mode. Not legal advice. [`templates/`](templates)

## Use cases by industry

Nineteen runnable Node.js examples, each with a README that explains the business problem and why the envelope is shaped the way it is (routing, recipient types, places, authentication). [`use-cases/`](use-cases)

| Use case | Shows |
|---|---|
| [HR offer letters](use-cases/hr-offer-letters) | DOCX template merge, approver then signer |
| [Staffing onboarding](use-cases/staffing-onboarding) | Bulk send from CSV, automatic countersignature |
| [Real estate](use-cases/real-estate) | Sequential routing with several signers |
| [Property management leases](use-cases/property-management-leases) | Parallel routing, initials |
| [Lending](use-cases/lending) | Preparer, captured inputs |
| [Healthcare consent](use-cases/healthcare-consent) | Two-step authentication, no health data in metadata |
| [SaaS order forms](use-cases/saas-order-forms) | Automatic countersignature, dropdown |
| [Nonprofit volunteers](use-cases/nonprofit-volunteers) | Parallel routing, branding |
| [Agencies and SOWs](use-cases/agencies-sow) | Several documents in one envelope |
| [Insurance](use-cases/insurance) | Embedded ceremony |
| [Education enrollment](use-cases/education-enrollment) | Dropdown, radio group, validated inputs |
| [Law firm engagement](use-cases/law-firm-engagement) | Approver review, named deliverable |
| [Construction change orders](use-cases/construction-change-orders) | Approver, prefilled text |
| [Automotive](use-cases/automotive) | Auto-filled name, email and date places |
| [Logistics drivers](use-cases/logistics-drivers) | Short signing URL for SMS |
| [Marketplace providers](use-cases/marketplace-providers) | Embedded ceremony, redirect URL |
| [Fintech account opening](use-cases/fintech-account-opening) | Automatic countersignature, two-step authentication |
| [Public sector](use-cases/public-sector) | Official approver, the qualified signature path |
| [Telecom](use-cases/telecom) | Embedded ceremony with email code |

## No-code and low-code platforms

Code and workflows that run inside automation platforms. Each folder's tests check them locally, without an account on the platform:

- [Google Apps Script](no-code/apps-script): one envelope per Google Sheets row, with each status refreshed by a time-driven trigger.
- [Airtable](no-code/airtable): an automation script that creates an envelope per record, with the key in an Airtable secret.
- [Pipedream](no-code/pipedream): a Node.js code step that creates an envelope from a trigger event.
- [n8n](no-code/n8n): seven importable workflows built from n8n's own HTTP Request node, including a verified `deliverable.generated` webhook that downloads the signed PDF.

For other tools, use their generic HTTP request step with the same request body. [Power Automate](https://signatureapi.com/docs/integrations/power-automate/quickstart) has an official connector.

## API collections

Postman, Bruno, Insomnia and HTTPie collections generated from the [OpenAPI spec](https://spec.signatureapi.com/openapi.yaml), with a test-mode environment. [`collections/`](collections)

## How the examples are tested

`bash .github/scripts/run-folder.sh <folder>` runs one folder's tests exactly as CI does. Node.js and Python run on the host. PHP, Ruby, Go, Java and C# run in official Docker images pinned by digest, so you need only Docker installed.

The [nightly workflow](.github/workflows/nightly.yml) runs every folder. Offline tests always run. Live tests run in test mode when the `SIGNATUREAPI_TEST_API_KEY` secret is set and skip cleanly without it. A second job regenerates the collections from the published spec and fails when they drift.

## Conventions

- **Test mode only.** Every example reads the key from `SIGNATUREAPI_KEY` and refuses keys that do not start with `key_test_`. Set `SIGNATUREAPI_BASE_URL` to point at another environment.
- **Synthetic data.** Names, emails and companies (Acme Corp, Jane Doe, `@example.com`) are fictional. Sample documents are served from `https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/`.
- **Signed PDFs wait for the deliverable.** `envelope.completed` means everyone has signed. The signed PDF is ready later: download it on `deliverable.generated`, or when the deliverable's `status` is `generated`.
- **Envelope IDs are UUIDs**, for example `eb4cf433-a8af-4161-b37b-7ef57d423e56`. Other objects use prefixes: `re_` recipients, `del_` deliverables, `evt_` events, `upl_` uploads.
- **Never commit a key.** `.env` files are ignored by git.

## Learn more

- [Documentation](https://signatureapi.com/docs)
- [API reference: create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Webhooks](https://signatureapi.com/docs/api/webhooks)
- [Embedded signing](https://signatureapi.com/docs/embedded/introduction)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## License

[MIT](LICENSE)
