# Send offer letters for e-signature from your ATS (Node.js)

Merge candidate data into a DOCX offer letter and route it through the hiring manager to the candidate. Runs in test mode, needs no dependencies, and takes about a minute.

## The problem

Your applicant tracking system (ATS) knows the candidate name, title, start date and salary. Your offer letter lives in a Word file. Someone copies the values into the file, exports a PDF, and emails it. That is slow, and every copy is a chance for a typo in a salary.

With SignatureAPI you keep one DOCX template with merge fields and send the values as data. The API fills the template, adds the signature place, and routes the letter: first the hiring manager approves it, then the candidate signs.

## What you build

A small Node.js script (`index.mjs`) with two parts:

- `buildEnvelope()`: a pure function that returns the `POST /v1/envelopes` request body. No network, no clock, so it is easy to test.
- `send()` and `main()`: send it with the built-in `fetch` and print a summary.

API features shown: DOCX template merge (`data`), approver then signer, sequential routing, metadata, topics, fixed positions.

The envelope shape and why:

- **One DOCX document with `data`.** The template contains `{{ date }}`, `{{ candidateName }}`, `{{ jobTitle }}`, `{{ startDate }}` and `{{ salary }}`. The `data` object supplies one value for each. Set `format` to `docx`.
- **Two recipients, sequential routing.** The hiring manager is an `approver` and goes first. The candidate is a `signer` and receives the letter only after approval. Approvers get no signature place.
- **Places by fixed position.** The sample template has no `[[placeholders]]`, so the signature and the signing date are placed with `fixed_positions` (page, `top`, `left`, in points). If you add `[[candidate_signature]]` to your own template you can drop `fixed_positions`.
- **Metadata and topics.** `metadata.ats_candidate_id` carries your ATS id, so a webhook handler can find the candidate again. `topics` (`hr`, `offer_letters`) let you filter webhooks and list envelopes by category.

## Prerequisites

- Node.js 20 or newer (uses the built-in `fetch` and `node:test`). No `npm install` needed.
- A SignatureAPI **test** API key. It starts with `key_test_`. Create one in the [dashboard](https://dashboard.signatureapi.com). The script refuses any other key.

## Step by step

1. **Set the key.** Export it. The script never prints it.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Inspect the template fields.** Open the sample template and list its merge fields. The `data` keys must match them exactly. The sample has five: `date`, `candidateName`, `jobTitle`, `startDate`, `salary`.
3. **Build the document object.** `buildEnvelope()` puts the template URL in `documents[0].url`, sets `format: "docx"`, and maps one candidate record onto `data`. Values are plain strings.
4. **Add the recipients in routing order.** The array order is the routing order. The approver `hiring_manager` is first, the signer `candidate` second. Both reference places by `key`.
5. **Attach your ATS id.** Put the candidate id in `metadata` and tag the envelope with `topics`. Metadata keys use letters, digits and underscores. Topics are lowercase.
6. **Override the defaults per candidate.** Call `buildEnvelope({ name, email, jobTitle, startDate, salary, recordId })` once per offer. Nothing else changes.
7. **Send it.** `send()` calls `POST /v1/envelopes` with the `X-API-Key` header and returns the created envelope. A `201 Created` response carries the envelope `id` (a UUID) and its `recipients`.

The full request body this example sends (default values):

```json
{
  "title": "Offer Letter - Jane Doe",
  "message": "Please review your offer letter and sign it to accept.",
  "routing": "sequential",
  "metadata": {
    "ats_candidate_id": "cand_1042",
    "source": "ats"
  },
  "topics": [
    "hr",
    "offer_letters"
  ],
  "documents": [
    {
      "key": "offer_letter",
      "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/offer-letter-template.docx",
      "format": "docx",
      "data": {
        "date": "November 17, 2026",
        "candidateName": "Jane Doe",
        "jobTitle": "Product Designer",
        "startDate": "January 11, 2027",
        "salary": "$95,000"
      },
      "fixed_positions": [
        {
          "place_key": "candidate_signature",
          "page": 1,
          "top": 300,
          "left": 72
        },
        {
          "place_key": "signed_on",
          "page": 1,
          "top": 330,
          "left": 72
        }
      ],
      "places": [
        {
          "key": "candidate_signature",
          "type": "signature",
          "recipient_key": "candidate"
        },
        {
          "key": "signed_on",
          "type": "recipient_completed_date",
          "recipient_key": "candidate"
        }
      ]
    }
  ],
  "recipients": [
    {
      "type": "approver",
      "key": "hiring_manager",
      "name": "Alex Chen",
      "email": "alex.chen@example.com"
    },
    {
      "type": "signer",
      "key": "candidate",
      "name": "Jane Doe",
      "email": "jane.doe@example.com"
    }
  ]
}
```

## Run it

```bash
cd use-cases/hr-offer-letters
node index.mjs
# or: npm start
```

Optional: set `SIGNATUREAPI_BASE_URL` to point at another API host. The default is `https://api.signatureapi.com`.

## Expected output

```text
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient hiring_manager: approver (re_1sAAaVfabdt0esVjmSTm0)
  recipient candidate: signer (re_1sAAaVfabdt0esVjmSTm1)
```

This output was produced by running `node index.mjs` against a local mock of the API, so the ids are the fixed example ids. Against the real API you get a real envelope id and the status `processing`, which becomes `in_progress` once the envelope is sent. Test envelopes send no emails: open the Email view in the dashboard in test mode to see what recipients would receive.

## Run the tests

```bash
npm test
```

The offline tests check the payload and run the whole flow against a local mock HTTP server. The live test runs only when `SIGNATUREAPI_KEY` is set. It creates a test-mode envelope and asserts `201` and a UUID `id`. Without a key it is reported as skipped.

## Troubleshooting

- **`401 Unauthorized`.** The key is missing, mistyped or revoked. Check `SIGNATUREAPI_KEY`.
- **"This example runs in test mode only".** The key does not start with `key_test_`. Examples never run against live mode.
- **`422 Unprocessable Entity`.** The request body failed validation. The script prints the API error detail. Compare your change with the body above and the [create envelope reference](https://signatureapi.com/docs/api/resources/envelopes/create).
- **`422` on `data`.** A value must be a string, boolean or an object of strings. Convert numbers to strings before sending, for example `"$95,000"`.
- **The letter shows an empty field.** The `data` key does not match the `{{ field }}` name in the template. Check spelling and case.
- **The signature lands in the wrong spot.** Fixed positions are in points from the top-left of the page. Send a test envelope, look at it in the dashboard, and adjust `top` and `left`. A `[[placeholder]]` in the template avoids this.
- **The candidate never gets the email.** Test envelopes send no email. Open the dashboard Email view in test mode to see what would have been sent.

## Learn more

- [Send offer letters for e-signature from your ATS: the guide](https://signatureapi.com/docs/use-cases/hr-offer-letters)
- [DOCX templates how-to](https://signatureapi.com/docs/api/guides/how-to/document-templates)
- [Document templates reference](https://signatureapi.com/docs/api/resources/documents/templates)
- [Approver recipient](https://signatureapi.com/docs/api/resources/recipients/approver)
- [Fixed positions](https://signatureapi.com/docs/api/guides/how-to/use-fixed-positions)
- [Send bulk envelopes](https://signatureapi.com/docs/api/guides/use-cases/bulk-envelopes)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## Files

- `index.mjs`
- `index.test.mjs`
- `package.json`
