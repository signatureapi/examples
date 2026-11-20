# SignatureAPI scripts in seven languages

The same three tasks in every language: **send** a document for e-signature, **check** the envelope status, and **download** the signed PDF. Node.js and Python also include **bulk send from a CSV file**.

| Language | Folder | Dependencies |
|---|---|---|
| Node.js 20+ | [`node/`](node) | None (built-in `fetch`) |
| Python 3.10+ | [`python/`](python) | None (standard library) |
| PHP 8.3 | [`php/`](php) | None (built-in HTTP streams) |
| Ruby 3.3 | [`ruby/`](ruby) | None (`net/http`) |
| Go 1.23 | [`go/`](go) | None (`net/http`) |
| Java 21 | [`java/`](java) | None (`java.net.http`) |
| C# (.NET 8) | [`csharp/`](csharp) | None (`HttpClient`) |

Every version sends the identical request body, reads the key from `SIGNATUREAPI_KEY`, refuses keys that do not start with `key_test_`, and has tests: offline tests against a local mock API that check the method, path, `X-API-Key` header and body, plus live tests that run in test mode when a key is set.

To send a file from your own disk, see [`upload-first/`](upload-first): it uploads the bytes to `POST /v1/uploads` and uses the returned URL.

`assets/acme-mark.png` is a synthetic image used by the live tests as the drawn mark of an [automatic signer](https://signatureapi.com/docs/api/resources/recipients/automatic-signer), so a test envelope completes without a human and the download step runs end to end.

Run any folder's tests the way CI does, from the repository root:

```bash
bash .github/scripts/run-folder.sh scripts/go
```
