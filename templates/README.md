# DOCX templates

Twelve ready-to-send DOCX templates with merge fields, written as fictional text for Acme Corp. Each folder has the template, sample data, an envelope definition and a README.

> Not legal advice. The text is sample text for demonstration. Have a lawyer review any document before you use it with real people.

| Folder | Template | Summary |
|---|---|---|
| [`offer-letter/`](offer-letter/) | Offer Letter | An offer of employment with a salary, a start date and an optional sign-on bonus. |
| [`mutual-nda/`](mutual-nda/) | Mutual Non-Disclosure Agreement | A mutual NDA between two companies with a term in years and a governing law. |
| [`employment-contract/`](employment-contract/) | Employment Contract | A fixed-form employment contract with an optional probation period. |
| [`contractor-agreement/`](contractor-agreement/) | Independent Contractor Agreement | An agreement for an independent contractor paid by the hour or by a fixed fee. |
| [`master-services-agreement/`](master-services-agreement/) | Master Services Agreement | A framework agreement that later statements of work refer to. |
| [`statement-of-work/`](statement-of-work/) | Statement of Work | A statement of work with a dynamic table of line items that grows with your data. |
| [`residential-lease/`](residential-lease/) | Residential Lease Agreement | A fixed-term lease for a home with rent, a deposit and an optional pet clause. |
| [`purchase-agreement/`](purchase-agreement/) | Purchase Agreement | A simple agreement to sell and buy an item with a price, a deposit and a delivery date. |
| [`medical-consent/`](medical-consent/) | Consent to Treatment | A general consent form for a routine visit. It holds no health data: describe the visit in general terms only. |
| [`liability-waiver/`](liability-waiver/) | Liability Waiver | A waiver for a recreational activity with an optional equipment clause. |
| [`permission-slip/`](permission-slip/) | School Permission Slip | A permission slip for a school trip, signed by a parent or guardian. |
| [`change-order/`](change-order/) | Change Order | A change order that adds a table of changed items and the new total to an existing contract. |

## Send one in test mode

```bash
export SIGNATUREAPI_KEY=key_test_...
node send-template.mjs offer-letter
```

`send-template.mjs` needs Node.js 20 or newer and no packages. It uploads `template.docx`, creates the envelope with the sample data and prints a summary. It works with test keys only.

## How templates work

A DOCX template holds fields written with double curly braces, plus optional `if` blocks and repeating tables. You send values in the `data` property of the document, and SignatureAPI produces the final document. Signature places are positioned with white-text placeholders in double brackets. See [Document Templates](https://signatureapi.com/docs/api/resources/documents/templates).

## Run the tests

```bash
node --test
```

The offline tests open every `template.docx`, check that each merge field has a value in `sample-data.json`, that each place in `envelope.json` has its placeholder in the document and points at a recipient, and build the request body. With `SIGNATUREAPI_KEY` set to a test key, one live test uploads the offer letter and creates a test-mode envelope.

## Regenerate

`python3 -I build_templates.py` rebuilds every folder. It needs `python-docx`.
