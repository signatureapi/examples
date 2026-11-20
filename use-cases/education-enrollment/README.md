# Collect enrollment forms from a guardian and a student (Node.js)

Gather structured answers with dropdowns, a radio group and a validated email field, plus two signatures. Runs in test mode, needs no dependencies, and takes about a minute.

## The problem

Enrollment needs structured answers (grade, state, meal plan, contact email) and signatures from a guardian and the student. A scanned form gives you neither clean data nor a clean audit trail.

Input places capture the answers as data and signatures complete the form. You read the values back from the envelope `captures`.

## What you build

A small Node.js script (`index.mjs`) with two parts:

- `buildEnvelope()`: a pure function that returns the `POST /v1/envelopes` request body. No network, no clock, so it is easy to test.
- `send()` and `main()`: send it with the built-in `fetch` and print a summary.

API features shown: Sequential routing, dropdown (predefined and custom options), radio group, text input with format, captures.

The envelope shape and why:

- **Dropdowns.** `grade` uses custom `{ label, value }` options. `state` uses the predefined list `us_states_2_letter_codes`.
- **Radio group.** `lunch_plan` has the options `none` and `standard`. Each option is positioned separately with a fixed position keyed `lunch_plan:none` and `lunch_plan:standard`.
- **Validated text input.** `guardian_email` uses `format: "email"` and a `format_message`.
- **Sequential routing.** The guardian fills in the form and signs first, then the student signs. Envelopes with form places (text inputs, checkboxes, dropdowns, radio groups) must use sequential routing; a parallel envelope with form places returns `422`.

## Prerequisites

- Node.js 20 or newer (uses the built-in `fetch` and `node:test`). No `npm install` needed.
- A SignatureAPI **test** API key. It starts with `key_test_`. Create one in the [dashboard](https://dashboard.signatureapi.com). The script refuses any other key.

## Step by step

1. **Set the key.** Export it. The script never prints it.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Define the input places.** Each input has a `recipient_key`, a `prompt`, and `capture_as` so the answer lands in `captures`.
3. **Position the radio options.** A radio group needs one fixed position per option, using the `key:value` form.
4. **Add the signatures.** Guardian and student each get a signature place.
5. **Read the data back.** After completion, `GET /v1/envelopes/{id}` returns `captures` with the values.
6. **Send it.** `send()` calls `POST /v1/envelopes` with the `X-API-Key` header and returns the created envelope. A `201 Created` response carries the envelope `id` (a UUID) and its `recipients`.

The full request body this example sends (default values):

```json
{
  "title": "Enrollment Form (sample)",
  "message": "Please complete the enrollment form and sign.",
  "routing": "sequential",
  "metadata": {
    "student_ref": "stu_8812",
    "school_year": "2027_2028"
  },
  "topics": [
    "education",
    "enrollment"
  ],
  "documents": [
    {
      "key": "enrollment_form",
      "url": "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
      "format": "pdf",
      "fixed_positions": [
        {
          "place_key": "grade",
          "page": 1,
          "top": 110,
          "left": 210
        },
        {
          "place_key": "state",
          "page": 1,
          "top": 130,
          "left": 210
        },
        {
          "place_key": "guardian_email",
          "page": 1,
          "top": 150,
          "left": 210
        },
        {
          "place_key": "lunch_plan:none",
          "page": 1,
          "top": 200,
          "left": 210
        },
        {
          "place_key": "lunch_plan:standard",
          "page": 1,
          "top": 200,
          "left": 330
        },
        {
          "place_key": "guardian_signature",
          "page": 1,
          "top": 172,
          "left": 210
        },
        {
          "place_key": "student_signature",
          "page": 1,
          "top": 186,
          "left": 220
        }
      ],
      "places": [
        {
          "key": "grade",
          "type": "dropdown",
          "recipient_key": "guardian",
          "prompt": "Grade",
          "options": [
            {
              "label": "Grade 6",
              "value": "g6"
            },
            {
              "label": "Grade 7",
              "value": "g7"
            },
            {
              "label": "Grade 8",
              "value": "g8"
            }
          ],
          "width": 120,
          "capture_as": "grade"
        },
        {
          "key": "state",
          "type": "dropdown",
          "recipient_key": "guardian",
          "prompt": "State",
          "options": "us_states_2_letter_codes",
          "width": 80,
          "capture_as": "state"
        },
        {
          "key": "guardian_email",
          "type": "text_input",
          "recipient_key": "guardian",
          "prompt": "Contact email",
          "format": "email",
          "format_message": "Enter a valid email address",
          "width": 220,
          "capture_as": "guardian_email"
        },
        {
          "key": "lunch_plan",
          "type": "radio_group",
          "recipient_key": "guardian",
          "options": [
            {
              "value": "none"
            },
            {
              "value": "standard"
            }
          ],
          "capture_as": "lunch_plan"
        },
        {
          "key": "guardian_signature",
          "type": "signature",
          "recipient_key": "guardian"
        },
        {
          "key": "student_signature",
          "type": "signature",
          "recipient_key": "student"
        }
      ]
    }
  ],
  "recipients": [
    {
      "type": "signer",
      "key": "guardian",
      "name": "Jane Doe",
      "email": "jane.doe@example.com"
    },
    {
      "type": "signer",
      "key": "student",
      "name": "Maria Garcia",
      "email": "maria.garcia@example.com"
    }
  ]
}
```

## Run it

```bash
cd use-cases/education-enrollment
node index.mjs
# or: npm start
```

Optional: set `SIGNATUREAPI_BASE_URL` to point at another API host. The default is `https://api.signatureapi.com`.

## Expected output

```text
Created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (status: processing)
  recipient guardian: signer (re_1sAAaVfabdt0esVjmSTm0)
  recipient student: signer (re_1sAAaVfabdt0esVjmSTm1)
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
- **`422` on radio options.** Option `value`s are lowercase letters, digits and underscores, up to 32 characters.
- **Email format rejected.** Built-in formats are `email` and `zipcode-us`. A custom format is a regular expression wrapped in slashes, like `/^[A-Z]{2}[0-9]{4}$/`.

## Learn more

- [Collect enrollment forms from a guardian and a student: the guide](https://signatureapi.com/docs/use-cases/education-enrollment)
- [Dropdown place](https://signatureapi.com/docs/api/resources/places/dropdown)
- [Radio group place](https://signatureapi.com/docs/api/resources/places/radio-group)
- [Text input place](https://signatureapi.com/docs/api/resources/places/text-input)
- [Envelope captures](https://signatureapi.com/docs/api/resources/envelopes/captures)
- [Place positioning](https://signatureapi.com/docs/api/resources/places/positioning)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Test mode](https://signatureapi.com/docs/api/test-mode)

## Files

- `index.mjs`
- `index.test.mjs`
- `package.json`
