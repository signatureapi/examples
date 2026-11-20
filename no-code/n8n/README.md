# Send documents for e-signature from n8n (HTTP Request node workflows)

Seven n8n workflows that create SignatureAPI envelopes and download signed PDFs. They use only n8n's built-in nodes: the HTTP Request node with one Header Auth credential, plus Webhook, Code, Form, Schedule and Respond to Webhook nodes. No community node to install. Test mode only.

## What's inside

| File | Trigger | What it does |
| --- | --- | --- |
| `store-templates.json` | Manual | Downloads three DOCX templates, uploads each to SignatureAPI and stores it permanently. Run it once. |
| `employment-contract.json` | Webhook | Merges a new hire into the employment contract template. HR approves, then the employer signs, then the employee. |
| `deliverable-on-completion.json` | Webhook | Receives `deliverable.generated`, verifies the webhook signature, and downloads the signed PDF. |
| `nda-batch.json` | Manual | Sends one mutual NDA per row, at most 5 requests per second. |
| `lease-renewal.json` | Schedule (daily) | Finds leases that end in the next 60 days and sends a one-year renewal: the tenant signs, then the landlord. |
| `invoice-approval.json` | Webhook | A manager approves an invoice PDF, then finance signs it off. |
| `form-to-envelope.json` | n8n Form | Your team fills a form; the candidate gets an offer letter to sign. |

## What was tested

Each workflow ran end to end on a local n8n 2.43.4 (Docker image `n8nio/n8n:2.43.4`) against the SignatureAPI API in test mode, and each file here is the export of the workflow that ran, with ids removed:

- The envelope workflows created their envelopes, and every envelope reached `in_progress` with the expected recipient order.
- The signed-PDF workflow received a real `deliverable.generated` delivery, verified its signature, and downloaded the PDF. The same delivery with one changed byte was refused.
- Every file imports into a fresh n8n with `n8n import:workflow` without errors.

`npm test` checks the files offline: they parse, use only built-in nodes, keep the key in the credential, carry no instance, webhook or credential ids, and the Code nodes build valid envelope bodies from sample input.

## Prerequisites

- An n8n instance. These workflows were tested on self-hosted n8n 2.43.4. The signed-PDF workflow reads environment variables that you set when you start n8n (step 5).
- A SignatureAPI **test** API key (`key_test_...`) from the [dashboard](https://dashboard.signatureapi.com).

## Step by step

1. **Create the credential.** In n8n, create a credential of type **Header Auth** named `SignatureAPI test key`. Set **Name** to `X-API-Key` and **Value** to your test API key. Every HTTP Request node that calls SignatureAPI uses it. See n8n's [HTTP Request credentials](https://docs.n8n.io/integrations/builtin/credentials/httprequest/).
2. **Import a workflow.** Open a new workflow, open the workflow menu, choose **Import from File...** and pick a JSON file from this folder ([n8n: export and import workflows](https://docs.n8n.io/workflows/export-import/)). If a SignatureAPI node shows a credential warning, select `SignatureAPI test key` in it.
3. **Store your templates.** Import `store-templates.json` and run it once. It stores the employment contract, mutual NDA and residential lease templates from the SignatureAPI docs. The **Store upload** node outputs one `url` per template, such as `https://api.signatureapi.com/v1/uploads/upl_...`. You can also upload a file in the dashboard [Library](https://signatureapi.com/docs/dashboard/library) and copy its URL.
4. **Paste the template URL.** In `employment-contract.json`, `nda-batch.json` and `lease-renewal.json`, open the Code node that builds the envelope and replace `REPLACE_WITH_YOUR_TEMPLATE_URL` with the matching URL. `form-to-envelope.json` uses a public sample template and needs no change. `invoice-approval.json` takes the invoice PDF URL from each request.
5. **Signed-PDF workflow only.** Start n8n with three environment variables:
   - `SIGNATUREAPI_WEBHOOK_SECRET`: the signing secret of your SignatureAPI webhook endpoint.
   - `NODE_FUNCTION_ALLOW_BUILTIN=crypto`: lets the Code node load Node.js `crypto` ([n8n: node environment variables](https://docs.n8n.io/hosting/configuration/environment-variables/nodes/)).
   - `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`: lets the Code node read `$env` ([n8n: security environment variables](https://docs.n8n.io/hosting/configuration/environment-variables/security/)). n8n 2.43.4 blocked it without this variable.

   Then activate the workflow and add a webhook endpoint in the SignatureAPI dashboard for `deliverable.generated`, with the workflow's production URL (`https://<your-n8n>/webhook/signatureapi-events`).
6. **Activate** the webhook and form workflows to use their production URLs.

## Try it

Send a new hire to the employment contract workflow:

```bash
curl -X POST https://<your-n8n>/webhook/employment-contract \
  -H 'Content-Type: application/json' \
  -d '{
    "reference": "HR-1042",
    "employee": { "name": "Maria Garcia", "email": "maria.garcia@example.com", "address": "12 Sample Lane, Springfield" },
    "job_title": "Customer Success Manager",
    "start_date": "2026-12-01",
    "salary": "72,000",
    "currency": "USD",
    "has_probation": true,
    "probation_months": 3,
    "weekly_hours": 40,
    "vacation_days": 25
  }'
```

Expected response (`201`):

```json
{ "envelope_id": "eb4cf433-a8af-4161-b37b-7ef57d423e56", "status": "processing" }
```

Send an invoice for approval:

```bash
curl -X POST https://<your-n8n>/webhook/invoice-approval \
  -H 'Content-Type: application/json' \
  -d '{
    "invoice_number": "INV-1001",
    "vendor": "Globex Example Ltd",
    "amount": "4,250.00",
    "currency": "USD",
    "pdf_url": "https://api.signatureapi.com/v1/uploads/upl_...",
    "approver": { "name": "Alex Chen", "email": "alex.chen@example.com" },
    "signer": { "name": "John Smith", "email": "john.smith@example.com" }
  }'
```

When the API refuses a request, both webhook workflows answer `502` with the API's error body, for example a `422` validation error.

## Test mode

The API key in the credential decides the mode. A test key creates test envelopes: free, not legally binding, and no email reaches the recipients. Switch to a live key only when you are ready to send real documents.

## Run the tests

```bash
npm test
```

## Learn more

- [n8n integration guide](https://signatureapi.com/docs/integrations/n8n)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create) and [document templates](https://signatureapi.com/docs/api/resources/documents/templates)
- [Webhooks](https://signatureapi.com/docs/api/webhooks) and [rate limits](https://signatureapi.com/docs/api/rate-limiting)
- [Test mode](https://signatureapi.com/docs/api/test-mode)
