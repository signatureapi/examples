# Send an e-signature envelope for every Google Sheets row with Apps Script

Turn a Google Sheet into a sending queue. One row is one signer. A menu item creates an envelope for each new row and writes the envelope id and status back into the sheet. A time-driven trigger then keeps each status up to date. Test mode only, no libraries.

## The problem

Small teams already keep their signers in a spreadsheet: new hires, vendors, clients. Copying each row into a signing tool by hand is slow and error prone. Google Apps Script runs inside the sheet and can call the SignatureAPI REST API directly, so the sheet can be the whole interface.

## What you build

- `Core.gs`: the platform-agnostic core. It builds the request body, picks the rows that still need an envelope or a status refresh, and calls the API through an injected `http` function. No Google service is used here.
- `Code.gs`: the thin Apps Script shim. It adds a menu, reads the key from Script Properties, calls `UrlFetchApp`, reads and writes the sheet, and installs the time-driven trigger.
- `core.test.mjs`: Node.js tests for both files.

Sheet layout, header in row 1: `name`, `email`, `role`, `envelope_id`, `status`.

## What was tested locally and what is platform glue

Tested on the host with `node --test` (no Google account involved):

- `Core.gs` loaded exactly as Apps Script loads it (a shared global scope), checking the payload, row selection for sending and for refreshing, the test-key guard, error handling and the exact HTTP call (URL, `X-API-Key` header, JSON body).
- `Code.gs` run against hand-written fakes of `SpreadsheetApp`, `PropertiesService`, `UrlFetchApp`, `ScriptApp` and `Utilities`, checking that ids and statuses are written back to the right cells, that a failing row does not stop the loop, that the refresh skips rows already `completed`, `canceled` or `failed`, and that the trigger runs `refreshStatuses` every hour.
- A live check that runs the real core against the API (create an envelope, then read it back), only when `SIGNATUREAPI_KEY` is set. It is skipped otherwise.

Not tested here, because it needs Google's runtime: the real `SpreadsheetApp`, `UrlFetchApp`, `PropertiesService` and `ScriptApp` services, the menu in the sheet UI, the authorization prompt, and the trigger schedule. Those steps follow Google's public documentation, linked below. Run the script once in your own sheet to confirm them.

## Prerequisites

- A Google account and a Google Sheet with the columns above.
- A SignatureAPI **test** API key (`key_test_YOUR_KEY`) from the [dashboard](https://dashboard.signatureapi.com).
- Node.js 20 or newer to run the tests (optional).

## Step by step

1. **Open the script editor.** In the sheet choose Extensions, then Apps Script. See the [Apps Script overview](https://developers.google.com/apps-script/overview).
2. **Add the files.** Create `Core.gs` and `Code.gs` and paste the contents of the files in this folder. In Project Settings, tick "Show appsscript.json manifest file in editor" and paste `appsscript.json` so the script asks only for the scopes it uses.
3. **Store the key.** In Project Settings, under Script Properties, add `SIGNATUREAPI_KEY` with your test key. The code reads it with [`PropertiesService`](https://developers.google.com/apps-script/reference/properties/properties-service). Do not paste the key into the code. Anyone who can edit the script can read script properties, so share the script with care.
4. **Understand the call.** `httpFetch_` wraps [`UrlFetchApp.fetch`](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app) with `muteHttpExceptions: true` so an API error comes back as a status and body that the core turns into a readable message.
5. **Run it.** Reload the sheet, open the new SignatureAPI menu, choose "Send envelopes for new rows", and authorize the script when asked. For each row without an `envelope_id`, the script posts to `POST /v1/envelopes`, then writes the returned id and status into columns D and E. A failing row gets `error: ...` in the status column and the loop continues. A 200 ms pause between rows keeps you inside the rate limit.

## Keep the statuses up to date

6. **Install the trigger.** In the editor, select `installRefreshTrigger` and click Run once. It creates an [installable time-driven trigger](https://developers.google.com/apps-script/guides/triggers/installable) that runs `refreshStatuses` every hour. Approve the extra authorization prompt: managing triggers needs the `script.scriptapp` scope, which `appsscript.json` lists.
7. **What each run does.** `refreshStatuses` reads the first sheet. It skips rows without an `envelope_id` and rows already `completed`, `canceled` or `failed`. For every other row it calls `GET /v1/envelopes/{id}` with your key and writes the current `status`. A failing read gets `error: ...` and the loop continues, with the same 200 ms pause between rows.

Why not a webhook? SignatureAPI counts a webhook delivery as successful only when the endpoint answers with a `2XX` status. An Apps Script web app answers through a redirect to a one-time URL on `script.googleusercontent.com` (see Google's [Content service guide](https://developers.google.com/apps-script/guides/content)), so it cannot acknowledge a delivery. Reading the status on a schedule avoids that.

**Downloading the signed PDF.** `envelope.completed` tells you the signing is done. It does not mean the PDF is ready. When a row turns `completed`, check `deliverable.status` in the same response: download only when it is `generated`. Until then `deliverable.url` is `null`, and the link expires after an hour. The refresh skips completed rows on later runs, so if you add a download, run it on every row that does not have its PDF yet, not only on rows that just turned `completed`.

## Run the tests

```bash
npm test
```

## Expected output

```text
✔ core: builds a valid envelope payload from a sheet row
✔ core: pendingRows_ picks rows without an envelope id
✔ core: refuses a missing or live key
✔ core: rowsToRefresh_ picks rows whose envelope can still change
✔ core: getEnvelope_ refuses anything but an envelope UUID
✔ core: createEnvelope_ sends the key header and JSON body through the injected http function
✔ core: an API error becomes a readable exception
✔ shim: sendEnvelopesFromSheet writes the envelope id and status back to the row
✔ shim: a failing row gets an error status and the loop continues
✔ shim: refreshStatuses writes the current status of every open envelope and skips final rows
✔ shim: a failing read gets an error status and the refresh continues
✔ shim: installRefreshTrigger creates an hourly time-driven trigger for refreshStatuses
﹣ live: the core creates a test-mode envelope and reads it back # SIGNATUREAPI_KEY is not set, live test skipped
```

In the sheet, a processed row looks like this:

| name | email | role | envelope_id | status |
|---|---|---|---|---|
| Jane Doe | jane.doe@example.com | Designer | eb4cf433-a8af-4161-b37b-7ef57d423e56 | processing |

## Troubleshooting

- **"Set the SIGNATUREAPI_KEY script property".** The property is missing or has another name.
- **"This example runs in test mode only".** The key must start with `key_test_`.
- **Authorization or "not permitted to call UrlFetchApp.fetch".** The manifest scopes must include `script.external_request`, and you must approve the prompt. See Google's [authorization guide](https://developers.google.com/apps-script/guides/services/authorization).
- **`422` in the status column.** Usually a malformed email address in the row.
- **Script runs twice and creates duplicates.** Rows with an `envelope_id` are skipped, so a second run only sends new rows. If a run stops halfway, check the sheet before re-running.
- **Statuses never change.** Check that the trigger exists (Triggers, in the editor's left menu) and that the sheet with the envelopes is the first sheet of the spreadsheet.
- **"You do not have permission to call ScriptApp.newTrigger".** The manifest must include the `script.scriptapp` scope. Run `installRefreshTrigger` again and approve the prompt.

## Learn more

- [Use-case guides](https://signatureapi.com/docs/use-cases/overview) and the [create envelope reference](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Google Apps Script integration guide](https://signatureapi.com/docs/integrations/google-apps-script)
- [Deliverables](https://signatureapi.com/docs/api/resources/deliverables/object)
- [Send bulk envelopes](https://signatureapi.com/docs/api/guides/use-cases/bulk-envelopes)
- [Test mode](https://signatureapi.com/docs/api/test-mode)
- [Rate limiting](https://signatureapi.com/docs/api/rate-limiting)
