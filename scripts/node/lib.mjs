// Shared helpers for the SignatureAPI Node.js scripts.
// Zero dependencies: Node 20+ ships fetch, FormData and node:test.

import { pathToFileURL } from 'node:url';

export const DEFAULT_BASE_URL = 'https://api.signatureapi.com';

/** Reads the API key and base URL from the environment. Test keys only. */
export function getConfig(env = process.env) {
  const apiKey = env.SIGNATUREAPI_KEY;
  if (!apiKey) {
    throw new Error('Set SIGNATUREAPI_KEY to your test API key (it starts with key_test_).');
  }
  if (!apiKey.startsWith('key_test_')) {
    throw new Error('These examples run in test mode only. Use a key that starts with key_test_.');
  }
  const baseUrl = (env.SIGNATUREAPI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return { apiKey, baseUrl };
}

/** Error thrown for any non-2xx response. Carries the status and the parsed problem body. */
export class ApiError extends Error {
  constructor(status, body) {
    const detail = body && typeof body === 'object' ? body.detail || body.title : body;
    super(`SignatureAPI returned ${status}${detail ? `: ${detail}` : ''}`);
    this.status = status;
    this.body = body;
  }
}

/** Calls the API and returns the parsed JSON body. */
export async function api(config, method, path, { json, body, contentType } = {}) {
  const headers = { 'X-API-Key': config.apiKey, Accept: 'application/json' };
  let payload = body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(json);
  } else if (contentType) {
    headers['Content-Type'] = contentType;
  }
  const response = await fetch(`${config.baseUrl}${path}`, { method, headers, body: payload });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) throw new ApiError(response.status, parsed);
  return parsed;
}

export const SAMPLE_PDF_URL = 'https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf';

/**
 * Builds a one-signer envelope for the sample Service Agreement.
 * The sample PDF has no [[placeholders]], so the signature place uses fixed coordinates.
 */
export function buildServiceAgreement({ name = 'Jane Doe', email = 'jane.doe@example.com', metadata = {} } = {}) {
  return {
    title: 'Service Agreement',
    message: 'Hi, please review and sign the Acme Corp Service Agreement.',
    metadata,
    documents: [
      {
        url: SAMPLE_PDF_URL,
        format: 'pdf',
        places: [{ key: 'client_signature', type: 'signature', recipient_key: 'client' }],
        fixed_positions: [{ place_key: 'client_signature', page: 1, top: 172, left: 210 }],
      },
    ],
    recipients: [{ key: 'client', type: 'signer', name, email }],
  };
}

/** Prints an error the way every script does, then exits non-zero. */
export function fail(error) {
  console.error(`Error: ${error.message}`);
  if (error.body && typeof error.body === 'object' && error.body.errors) {
    console.error(JSON.stringify(error.body.errors, null, 2));
  }
  process.exit(1);
}

/** True when the module is run directly (node file.mjs), false when imported by a test. */
export function isMain(moduleUrl) {
  return Boolean(process.argv[1]) && moduleUrl === pathToFileURL(process.argv[1]).href;
}
