// Open accounts with a two-step signed agreement and automatic countersign (Node.js)
// Zero dependencies. Needs Node.js 20 or newer (built-in fetch).
import { pathToFileURL } from 'node:url';

export const DOC_URL = 'https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf';
export const TEMPLATE_URL = 'https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/offer-letter-template.docx';
const DEFAULT_BASE_URL = 'https://api.signatureapi.com';

// Signature lines on page 1 of the sample PDF, in points from the top-left corner.
export const CLIENT_LINE = { page: 1, top: 172, left: 210 };
export const PROVIDER_LINE = { page: 1, top: 186, left: 220 };

// An abstract synthetic mark (not anyone's signature) used for the automatic signer.
const MARK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAPAAAABQCAAAAAACIqegAAABV0lEQVR42u3cQQ6DMAxE0Z6E+9+yXVZtocTODLLJ9x5NHkRAHMTjuVg9AAO+IXhbpN7gNS4uYMCAAQMGDBgwYMCAAQMG7AZ/r7vNlKE0I3iv1XAN91+aDXzUXbmGe5xmAv9GOsmRNA94N84mDqU5wMdn10EOphnAf28ZcnE0TQ8+eSqIxeE0OfgUJBXH09TgAY5QnEjTgscmrGpap9Kk4FGJRpxLU4LHHQpxMk0IDiGmxdk0HThImBSn02TgMGBKnE9TgRPDnxBPpOnAlwx7Km0XvF03guxR6bR9cIeRz0zGX3CDuakE97n7qMBtni8ycJc3CB24yTuiENxjFaAEt1jnScEdVvJacINejRpcvhsnB1fvt+rBxTvqBnDtPRMHuPSumAdceN/TBK67s20DV/12wQiu+XWKFXyjAgwYMGDAgAEDBgwYMGDAgD/Bq/3WYqUCDPhm9QIdH2IrAN8+eQAAAABJRU5ErkJggg==';
const MARK_PLACEHOLDER_URL = 'https://api.signatureapi.com/v1/uploads/upl_xxxxxxxxxxxxxxxxxxxxxx';

/** Reads the configuration from the environment. Test keys only. */
export function config(env = process.env) {
  const key = env.SIGNATUREAPI_KEY;
  if (!key) throw new Error('Set SIGNATUREAPI_KEY to a test API key (key_test_...).');
  if (!key.startsWith('key_test_')) {
    throw new Error('This example runs in test mode only. Use a key that starts with key_test_.');
  }
  const baseUrl = (env.SIGNATUREAPI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return { key, baseUrl };
}

async function call(cfg, method, path, { json, raw, contentType } = {}) {
  const headers = { 'X-API-Key': cfg.key };
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (raw !== undefined) {
    headers['Content-Type'] = contentType;
    body = raw;
  }
  const response = await fetch(cfg.baseUrl + path, { method, headers, body });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const detail = data?.detail ?? data?.title ?? text;
    throw new Error(`${method} ${path} failed with ${response.status}: ${detail}`);
  }
  return data;
}

/** Uploads the synthetic mark and returns the upload URL to use as the signature image. */
export async function uploadMark(cfg) {
  const upload = await call(cfg, 'POST', '/v1/uploads', {
    raw: Buffer.from(MARK_PNG_BASE64, 'base64'),
    contentType: 'image/png',
  });
  return upload.url;
}


/** Builds the CreateEnvelope request body. Pure: no network, no clock. */
export function buildEnvelope(input = {}) {
  const app = { applicationId: 'app_8841', signatureUrl: MARK_PLACEHOLDER_URL, ...input };
  return {
    title: 'Account Agreement (sample)',
    message: 'Please accept the terms and sign your account agreement.',
    routing: 'sequential',
    metadata: { application_id: app.applicationId },
    topics: ['fintech', 'account_opening'],
    deliverable: { type: 'standard' },
    documents: [
      {
        key: 'account_agreement',
        url: DOC_URL,
        format: 'pdf',
        fixed_positions: [
          { place_key: 'accept_terms', page: 1, top: 130, left: 210 },
          { place_key: 'accept_esign', page: 1, top: 150, left: 210 },
          { place_key: 'customer_signature', ...CLIENT_LINE },
          { place_key: 'institution_countersignature', ...PROVIDER_LINE },
        ],
        places: [
          { key: 'accept_terms', type: 'checkbox', recipient_key: 'customer', requirement: 'required', capture_as: 'accepted_terms' },
          { key: 'accept_esign', type: 'checkbox', recipient_key: 'customer', requirement: 'required', capture_as: 'accepted_esign' },
          { key: 'customer_signature', type: 'signature', recipient_key: 'customer' },
          { key: 'institution_countersignature', type: 'signature', recipient_key: 'institution' },
        ],
      },
    ],
    recipients: [
      {
        type: 'signer',
        key: 'customer',
        name: 'Jane Doe',
        email: 'jane.doe@example.com',
        ceremony: { authentication: [{ type: 'email_link' }, { type: 'email_code' }] },
      },
      {
        type: 'automatic_signer',
        key: 'institution',
        name: 'Acme Corp Authorized Signatory',
        signature: { type: 'drawn', url: app.signatureUrl },
        mandate: 'Authorized by Acme Corp board resolution 2026-04 (synthetic example)',
      },
    ],
  };
}

/** Sends the use case to the API. Returns { envelopes, ceremonies }. */
export async function send(cfg, input = {}) {
  const signatureUrl = await uploadMark(cfg);
  const envelope = await call(cfg, 'POST', '/v1/envelopes', { json: buildEnvelope({ signatureUrl, ...input }) });
  return { envelopes: [envelope], ceremonies: [] };
}

function mask(url) {
  if (!url) return 'none (SignatureAPI delivers the link by email)';
  return `${url.slice(0, 32)}... (${url.length} chars, a bearer link: never log it in full)`;
}

export function summarize(result) {
  const lines = [];
  for (const envelope of result.envelopes) {
    lines.push(`Created envelope ${envelope.id} (status: ${envelope.status})`);
    for (const r of envelope.recipients ?? []) lines.push(`  recipient ${r.key}: ${r.type} (${r.id})`);
  }
  for (const c of result.ceremonies) lines.push(`  ceremony for ${c.recipientKey}: ${mask(c.url)}`);
  return lines.join('\n');
}

export async function main() {
  let cfg;
  try {
    cfg = config();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  try {
    console.log(summarize(await send(cfg)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
