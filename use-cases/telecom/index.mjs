// Sign service contracts on a store tablet with an embedded ceremony (Node.js)
// Zero dependencies. Needs Node.js 20 or newer (built-in fetch).
import { pathToFileURL } from 'node:url';

export const DOC_URL = 'https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf';
export const TEMPLATE_URL = 'https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/offer-letter-template.docx';
const DEFAULT_BASE_URL = 'https://api.signatureapi.com';

// Signature lines on page 1 of the sample PDF, in points from the top-left corner.
export const CLIENT_LINE = { page: 1, top: 172, left: 210 };
export const PROVIDER_LINE = { page: 1, top: 186, left: 220 };

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

/** A new envelope is "processing" for a moment. Wait until it is ready for a ceremony. */
export async function waitUntilReady(cfg, envelopeId, { tries = 20, delayMs = 500 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const envelope = await call(cfg, 'GET', `/v1/envelopes/${envelopeId}`);
    if (envelope.status !== 'processing') return envelope;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Envelope ${envelopeId} is still processing after ${tries} checks.`);
}

export function buildCeremony() {
  return {
    authentication: [{ type: 'email_code' }],
    embeddable_in: ['https://store.acme.example'],
    url_variant: 'short',
  };
}

export function embedSrc(ceremonyUrl) {
  const url = new URL(ceremonyUrl);
  url.searchParams.set('embedded', 'true');
  url.searchParams.set('event_delivery', 'message');
  return url.toString();
}
/** Builds the CreateEnvelope request body. Pure: no network, no clock. */
export function buildEnvelope(input = {}) {
  const order = { orderId: 'ord_telco_1', ...input };
  return {
    title: 'Service Contract (sample)',
    metadata: { order_id: order.orderId, store_id: 'store_12' },
    topics: ['telecom', 'service_contracts'],
    documents: [
      {
        key: 'service_contract',
        url: DOC_URL,
        format: 'pdf',
        fixed_positions: [
          { place_key: 'plan', page: 1, top: 130, left: 210 },
          { place_key: 'fee_initials', page: 1, top: 250, left: 72 },
          { place_key: 'customer_signature', ...CLIENT_LINE },
        ],
        places: [
          {
            key: 'plan',
            type: 'dropdown',
            recipient_key: 'customer',
            prompt: 'Plan',
            options: [
              { label: 'Basic', value: 'basic' },
              { label: 'Unlimited', value: 'unlimited' },
            ],
            width: 120,
            capture_as: 'plan',
          },
          { key: 'fee_initials', type: 'initials', recipient_key: 'customer', height: 30 },
          { key: 'customer_signature', type: 'signature', recipient_key: 'customer' },
        ],
      },
    ],
    recipients: [{ type: 'signer', key: 'customer', name: 'John Smith', email: 'john.smith@example.com', delivery_type: 'none' }],
  };
}

/** Sends the use case to the API. Returns { envelopes, ceremonies }. */
export async function send(cfg, input = {}) {
  const envelope = await call(cfg, 'POST', '/v1/envelopes', { json: buildEnvelope(input) });
  await waitUntilReady(cfg, envelope.id);
  const recipient = envelope.recipients.find((r) => r.key === 'customer');
  const ceremony = await call(cfg, 'POST', `/v1/recipients/${recipient.id}/ceremonies`, { json: buildCeremony() });
  return { envelopes: [envelope], ceremonies: [{ recipientKey: recipient.key, url: ceremony.url }] };
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
