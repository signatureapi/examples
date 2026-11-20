// Send offer letters for e-signature from your ATS (Node.js)
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


/** Builds the CreateEnvelope request body. Pure: no network, no clock. */
export function buildEnvelope(input = {}) {
  const c = {
    name: 'Jane Doe',
    email: 'jane.doe@example.com',
    jobTitle: 'Product Designer',
    startDate: 'January 11, 2027',
    salary: '$95,000',
    date: 'November 17, 2026',
    recordId: 'cand_1042',
    ...input,
  };
  return {
    title: `Offer Letter - ${c.name}`,
    message: 'Please review your offer letter and sign it to accept.',
    routing: 'sequential',
    metadata: { ats_candidate_id: c.recordId, source: 'ats' },
    topics: ['hr', 'offer_letters'],
    documents: [
      {
        key: 'offer_letter',
        url: TEMPLATE_URL,
        format: 'docx',
        data: {
          date: c.date,
          candidateName: c.name,
          jobTitle: c.jobTitle,
          startDate: c.startDate,
          salary: c.salary,
        },
        fixed_positions: [
          { place_key: 'candidate_signature', page: 1, top: 300, left: 72 },
          { place_key: 'signed_on', page: 1, top: 330, left: 72 },
        ],
        places: [
          { key: 'candidate_signature', type: 'signature', recipient_key: 'candidate' },
          { key: 'signed_on', type: 'recipient_completed_date', recipient_key: 'candidate' },
        ],
      },
    ],
    recipients: [
      { type: 'approver', key: 'hiring_manager', name: 'Alex Chen', email: 'alex.chen@example.com' },
      { type: 'signer', key: 'candidate', name: c.name, email: c.email },
    ],
  };
}

/** Sends the use case to the API. Returns { envelopes, ceremonies }. */
export async function send(cfg, input = {}) {
  const envelope = await call(cfg, 'POST', '/v1/envelopes', { json: buildEnvelope(input) });
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
