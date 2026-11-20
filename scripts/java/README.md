# Send, track and download e-signature envelopes in Java

## The problem

You want to send a contract for e-signature from a Java backend without an SDK, and you want to see every request your code makes. Three small programs cover the core loop: send a document, check its status, and download the signed PDF.

## What you build

| Program | What it does | API call |
|---|---|---|
| `SendEnvelope.java` | Sends the sample Service Agreement to one signer | `POST /v1/envelopes` |
| `GetStatus.java` | Prints the envelope and recipient statuses | `GET /v1/envelopes/{id}` |
| `DownloadDeliverable.java` | Saves the signed PDF of a completed envelope | `GET /v1/deliverables/{id}` |

All three use `SignatureApiClient.java`, which holds the configuration, the request helper and the envelope builder. It uses `java.net.http.HttpClient` from the JDK. A small `MiniJson` class parses responses so no library is needed.

## Prerequisites

- JDK 17 or newer (tested on 21). No Maven or Gradle: `javac` and `java` are enough.
- A SignatureAPI test API key (it starts with `key_test_`). [Sign up](https://accounts.signatureapi.com/sign-up) to get one for free. Test envelopes have no legal effect and cost nothing.

## Step by step

1. **Configure the key.** The programs read `SIGNATUREAPI_KEY` from the environment and refuse any key that does not start with `key_test_`, so a copy-paste mistake never sends a live envelope. `SIGNATUREAPI_BASE_URL` is optional and defaults to `https://api.signatureapi.com`.

   ```bash
   export SIGNATUREAPI_KEY=key_test_YOUR_KEY
   ```

2. **Build the envelope.** One document, one signer. The sample PDF has no `[[placeholders]]`, so the signature place is positioned with `fixed_positions`: `top` and `left` are points from the top and left edges of page 1 to the bottom-left corner of the place. The place's `recipient_key` matches the recipient's `key`. That link tells SignatureAPI who signs where.

   ```java
     /**
      * A one-signer envelope for the sample Service Agreement. The sample PDF has no [[placeholders]],
      * so the signature place uses fixed positions (points, page 1).
      */
     public static String buildServiceAgreement(String name, String email) {
       return """
           {"title":"Service Agreement",\
           "message":"Hi, please review and sign the Acme Corp Service Agreement.",\
           "metadata":{},\
           "documents":[{"url":"%s","format":"pdf",\
           "places":[{"key":"client_signature","type":"signature","recipient_key":"client"}],\
           "fixed_positions":[{"place_key":"client_signature","page":1,"top":172,"left":210}]}],\
           "recipients":[{"key":"client","type":"signer","name":"%s","email":"%s"}]}"""
           .formatted(SAMPLE_PDF_URL, escape(name), escape(email));
     }
   ```

3. **Send it.** The send program posts the payload to `POST /v1/envelopes` with the `X-API-Key` header. The response is the full envelope: its id (a UUID) and the recipient statuses.

4. **Track it.** The status program reads `GET /v1/envelopes/{id}`. In production prefer [webhooks](../../webhooks) over polling. Use status reads for on-demand checks and reconciliation.

5. **Download the signed PDF.** Once the envelope is `completed`, its `deliverable` is generated. The download program reads the envelope, then `GET /v1/deliverables/{id}`, then fetches the deliverable's pre-signed `url` (valid for 1 hour). It does not send your API key to that URL.

## Run it

```bash
export SIGNATUREAPI_KEY=key_test_YOUR_KEY
java -cp out SendEnvelope "Jane Doe" jane.doe@example.com
java -cp out GetStatus eb4cf433-a8af-4161-b37b-7ef57d423e56
java -cp out DownloadDeliverable eb4cf433-a8af-4161-b37b-7ef57d423e56 signed.pdf
```

Run the status and download commands with the id printed by the first one. The download needs an envelope in the `completed` status. Test mode does not email the signer: open the envelope in the [dashboard](https://dashboard.signatureapi.com), preview the email and sign as Jane to complete it.

## Expected output

```text
$ java -cp out SendEnvelope "Jane Doe" jane.doe@example.com
Envelope created: eb4cf433-a8af-4161-b37b-7ef57d423e56
Status: processing
Recipient client: Jane Doe <jane.doe@example.com> (pending)

$ java -cp out GetStatus eb4cf433-a8af-4161-b37b-7ef57d423e56
Envelope eb4cf433-a8af-4161-b37b-7ef57d423e56: in_progress
  client (signer): sent

$ java -cp out DownloadDeliverable eb4cf433-a8af-4161-b37b-7ef57d423e56 signed.pdf
Saved deliverable del_5hN8sD2jKq7WxZ4mPv9Ta3 to signed.pdf (48213 bytes)
```

## Run the tests

```bash
javac -d out *.java && java -cp out ScriptsTest
```

The offline tests start `com.sun.net.httpserver.HttpServer` inside the test process. They check every request: method, path, `X-API-Key` header and body. The send body is compared with `expected-envelope.json`, which matches the `CreateEnvelope` schema in the [OpenAPI spec](https://signatureapi.com/docs/api/openapi). They also check that the download never sends your API key to the pre-signed URL.

Real output:

```text
ok   - config requires a key
ok   - config refuses live keys
ok   - send: returns the envelope id
ok   - send: POST /v1/envelopes with the API key
ok   - send: body matches expected-envelope.json
ok   - get: returns the envelope
ok   - get: GET /v1/envelopes/{id} with the API key
ok   - download: saves a PDF
ok   - download: calls envelope, deliverable, then the signed URL
ok   - download: never sends the API key to the signed URL
ok   - 401 raises ApiException
skip - live test: SIGNATUREAPI_KEY is not set
11 passed, 0 failed, 1 skipped
```

With `SIGNATUREAPI_KEY` set, the live test also creates a test-mode envelope and reads it back. Without the key it is skipped, as above.

The offline tests ran in the pinned official image `eclipse-temurin@sha256:db5cc6341a1d7bc40cdb51e1f0d9824f3bb2cc8107d29da421dc4df7d11f05f1` (`eclipse-temurin:21-jdk`).

## Troubleshooting

- **`401 Unauthorized`**: the key is missing, mistyped or revoked. Copy it again from the dashboard.
- **`422 Unprocessable Entity`**: the payload breaks a rule. The error body lists each problem with a pointer to the field, and the programs print it. A common cause is a `recipient_key` that matches no recipient.
- **"These examples run in test mode only"**: the key does not start with `key_test_`. Use a test key.
- **"Envelope is in_progress"** when downloading: the deliverable exists only after every recipient finishes. Sign in the test ceremony first.
- **Download returns 403**: the pre-signed URL expired after 1 hour. Run the program again to get a fresh one.
- **`javac: file not found`**: run `javac -d out *.java` from the `java/` folder first.

## Learn more

- [Quickstart](https://signatureapi.com/docs/api/guides/quickstart)
- [Create an envelope](https://signatureapi.com/docs/api/resources/envelopes/create)
- [Place positioning](https://signatureapi.com/docs/api/resources/places/positioning)
- [Deliverables](https://signatureapi.com/docs/api/resources/deliverables/object)
- [Test mode](https://signatureapi.com/docs/api/test-mode)
- [Errors](https://signatureapi.com/docs/api/errors)
