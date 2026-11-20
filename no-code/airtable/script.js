// Airtable automation, "Run script" action.
// Input variables to define in the action: name, email, recordId (and optionally baseUrl).
// Secret to add in the script editor: apiKey, your test key. The script reads it with input.secret().

// ---- core: platform-agnostic, tested on Node.js (see script.test.mjs) ----
const DOC_URL = 'https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf';
const DEFAULT_BASE_URL = 'https://api.signatureapi.com';

function requireTestKey(apiKey) {
  if (!apiKey) throw new Error('Add a secret named apiKey with a test key (key_test_...).');
  if (!String(apiKey).startsWith('key_test_')) throw new Error('This example runs in test mode only. Use a key that starts with key_test_.');
}

function buildEnvelopePayload(rec) {
  return {
    title: `Service Agreement - ${rec.name}`,
    message: 'Please review and sign the service agreement.',
    metadata: { source: 'airtable', record_id: rec.recordId },
    topics: ['no_code', 'airtable'],
    documents: [
      {
        key: 'service_agreement',
        url: DOC_URL,
        format: 'pdf',
        fixed_positions: [{ place_key: 'signer_signature', page: 1, top: 172, left: 210 }],
        places: [{ key: 'signer_signature', type: 'signature', recipient_key: 'signer' }],
      },
    ],
    recipients: [{ type: 'signer', key: 'signer', name: rec.name, email: rec.email }],
  };
}

async function createEnvelope(cfg, payload, fetchFn) {
  requireTestKey(cfg.apiKey);
  const response = await fetchFn(`${(cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')}/v1/envelopes`, {
    method: 'POST',
    headers: { 'X-API-Key': cfg.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`POST /v1/envelopes failed with ${response.status}: ${(data && (data.detail || data.title)) || text}`);
  return data;
}
// ---- end core ----

// ---- Airtable shim: uses input, output and fetch, which Airtable provides ----
const config = input.config();
const envelope = await createEnvelope(
  { apiKey: input.secret('apiKey'), baseUrl: config.baseUrl },
  buildEnvelopePayload({ name: config.name, email: config.email, recordId: config.recordId }),
  fetch,
);
output.set('envelope_id', envelope.id);
output.set('status', envelope.status);
