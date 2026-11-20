# Independent Contractor Agreement DOCX template

An agreement for an independent contractor paid by the hour or by a fixed fee. Fictional text for Acme Corp, ready to merge and send in test mode.

> Not legal advice. This is sample text for demonstration. Have a lawyer review any document before you use it with real people.

## What is in this folder

- `template.docx`: the DOCX template with merge fields and signature placeholders.
- `sample-data.json`: example values for the `data` property of the document.
- `envelope.json`: the recipients and places for the envelope, with `title` and `message`.
- `../send-template.mjs`: a zero-dependency script that uploads the template and creates a test-mode envelope.

## Send it in test mode

You need Node.js 20 or newer and a SignatureAPI **test** API key (it starts with `key_test_`). Create one in the [dashboard](https://dashboard.signatureapi.com).

```bash
export SIGNATUREAPI_KEY=key_test_...
node ../send-template.mjs contractor-agreement
```

Run it from this folder, or pass the path to the template folder. The script refuses any key that is not a test key and never prints the key.

## Merge fields

SignatureAPI merges the values in `data` into the template before signing. A field is written with double curly braces. Dots reach nested values, and `if` blocks show or hide a section. Details are in [Document Templates](https://signatureapi.com/docs/api/resources/documents/templates).

| Field | Sample value |
|---|---|
| `company.name` | Acme Corp |
| `contractor.name` | John Smith |
| `contractor.address` | 8 Example Court, Capital City |
| `services` | website design and front-end development |
| `isHourly` | true |
| `currency` | USD |
| `hourlyRate` | 95 |
| `paymentDays` | 30 |
| `fixedFee` | 12,000 |
| `endDate` | 2027-02-28 |
| `noticeDays` | 14 |
| `effectiveDate` | 2026-11-02 |
| `company.signatory` | Alex Chen |

## Places

The template has white-text placeholders in double brackets. Each one is replaced by a signature place when the envelope is processed.

- `company_signs_here` for the recipient `company`
- `contractor_signs_here` for the recipient `contractor`

Recipients in `envelope.json`:

- `company`: Alex Chen
- `contractor`: John Smith

## Make it yours

1. Open `template.docx` in Microsoft Word and change the text. Keep each field inside one run of text: type it in one go, without changing the formatting in the middle.
2. Keep names used inside `if` blocks in camelCase or a single word. Underscores in those names cause a template error.
3. Change the values in `sample-data.json`, or send your own `data` from code.
4. Save the file from Word. DOCX files from other editors may fail to parse.

The `build_templates.py` script one level up shows how these files are generated.

## Learn more

- [Document Templates](https://signatureapi.com/docs/api/resources/documents/templates)
- [Place positioning](https://signatureapi.com/docs/api/resources/places/positioning)
