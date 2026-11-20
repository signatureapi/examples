# Upload your own PDF or DOCX and send it for e-signature (Node.js)

Send a file from your own disk for signature: upload the bytes to SignatureAPI, then create the envelope from the returned URL. No public hosting needed.

## The problem

Your contracts live on your server, in a database, or in a private bucket. SignatureAPI downloads each document from its `url` when you create the envelope, and only accepts URLs from [supported hosts](https://signatureapi.com/docs/api/resources/documents/url#external-store). A link to your own website returns `422`. Uploading the file first solves that.

## What you build

`send-local-file.mjs` (zero dependencies, Node.js 20+):

1. Reads a local `.pdf` or `.docx` file.
2. Sends the raw bytes to `POST /v1/uploads` with the matching `Content-Type`.
3. Creates an envelope whose document `url` is the upload URL (`https://api.signatureapi.com/v1/uploads/upl_...`).

`service-agreement.pdf` is a one-page synthetic sample you can send right away.

## Prerequisites

- Node.js 20 or newer.
- A SignatureAPI test API key (`key_test_...`). [Sign up](https://accounts.signatureapi.com/sign-up) for free.

## Step by step

1. **Upload the bytes.** Send the file as the request body, not as JSON or a form:

   ```js
   const upload = await call(config, 'POST', '/v1/uploads', {
     body: bytes,
     headers: { 'Content-Type': 'application/pdf' },
   });
   ```

   Supported types: `application/pdf`, the DOCX type, and `image/png` (for signature images). Maximum size: 4.5 MB.

2. **Use the upload URL as the document URL.** Set `format` to match the file:

   ```js
   documents: [{ url: upload.url, format: 'pdf', places: [...], fixed_positions: [...] }]
   ```

3. **Create the envelope within 24 hours.** API uploads expire after 24 hours. To reuse a file across many envelopes, [store the upload](https://signatureapi.com/docs/api/resources/uploads/store) or add it to the dashboard Library.

4. **Position the signature for your file.** The coordinates in the script fit the bundled sample. For your own document, add `[[client_signature]]` to the text and remove `fixed_positions`, or measure your own coordinates.

## Run it

```bash
export SIGNATUREAPI_KEY=key_test_YOUR_KEY
node send-local-file.mjs service-agreement.pdf "Jane Doe" jane.doe@example.com
```

## Expected output

```text
Uploaded service-agreement.pdf and created envelope eb4cf433-a8af-4161-b37b-7ef57d423e56 (processing)
```

## Run the tests

```bash
npm test
```

Offline tests use a local mock API and check that the raw bytes go to `/v1/uploads` with the right `Content-Type`, and that the envelope uses the returned URL. With `SIGNATUREAPI_KEY` set, a live test uploads the sample and creates a real test-mode envelope.

## Troubleshooting

- **`422` with "must be from one of the hosts listed"**: you passed your own URL as the document `url`. Upload the file first, or host it on a supported store.
- **`413` or "larger than 4.5 MB"**: host the file on a supported external store such as S3 or Azure Blob Storage and pass that URL.
- **`422` about the upload URL after a day**: the upload expired. Upload again, or store it.
- **`415` or a format error**: the `Content-Type` does not match the bytes. Send `application/pdf` for PDF files.

## Learn more

- [Create an upload](https://signatureapi.com/docs/api/resources/uploads/create)
- [Document URL and upload](https://signatureapi.com/docs/api/resources/documents/url)
- [Store an upload](https://signatureapi.com/docs/api/resources/uploads/store)
- [Place positioning](https://signatureapi.com/docs/api/resources/places/positioning)
