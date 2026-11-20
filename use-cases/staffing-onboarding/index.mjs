// Bulk-send placement agreements from a CSV and countersign automatically (Node.js)
// Zero dependencies. Needs Node.js 20 or newer (built-in fetch).
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
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

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);
  const [header, ...body] = rows;
  return body.map((cells) => Object.fromEntries(header.map((h, i) => [h.trim(), (cells[i] ?? '').trim()])));
}
/** Builds the CreateEnvelope request body. Pure: no network, no clock. */
export function buildEnvelope(input = {}) {
  const row = {
    record_id: 'cand_2001',
    candidate_name: 'Jane Doe',
    email: 'jane.doe@example.com',
    role: 'Warehouse Associate',
    start_date: '2027-01-11',
    signatureUrl: MARK_PLACEHOLDER_URL,
    ...input,
  };
  return {
    title: `Placement Agreement - ${row.candidate_name}`,
    // Keep dates and other digit runs out of recipient-visible text: the anti-spam check treats them like phone numbers.
    message: `Please sign your placement agreement for the ${row.role} role.`,
    routing: 'sequential',
    metadata: { record_id: row.record_id, batch_id: '2026_11_wave_1' },
    topics: ['staffing', 'onboarding'],
    documents: [
      {
        key: 'placement_agreement',
        url: DOC_URL,
        format: 'pdf',
        fixed_positions: [
          { place_key: 'candidate_signature', ...CLIENT_LINE },
          { place_key: 'agency_countersignature', ...PROVIDER_LINE },
        ],
        places: [
          { key: 'candidate_signature', type: 'signature', recipient_key: 'candidate' },
          { key: 'agency_countersignature', type: 'signature', recipient_key: 'agency' },
        ],
      },
    ],
    recipients: [
      { type: 'signer', key: 'candidate', name: row.candidate_name, email: row.email },
      {
        type: 'automatic_signer',
        key: 'agency',
        name: 'Acme Corp Authorized Signatory',
        signature: { type: 'drawn', url: row.signatureUrl },
        mandate: 'Authorized by Acme Corp board resolution 2026-04 (synthetic example)',
      },
    ],
  };
}

/** Sends the use case to the API. Returns { envelopes, ceremonies }. */
export async function send(cfg, input = {}) {
  const rows = input.rows ?? parseCsv(readFileSync(new URL('./candidates.csv', import.meta.url), 'utf8'));
  const signatureUrl = await uploadMark(cfg);
  const envelopes = [];
  for (const row of rows) {
    envelopes.push(await call(cfg, 'POST', '/v1/envelopes', { json: buildEnvelope({ ...row, signatureUrl }) }));
    await new Promise((resolve) => setTimeout(resolve, input.delayMs ?? 200));
  }
  return { envelopes, ceremonies: [] };
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
