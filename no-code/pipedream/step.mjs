// Pipedream Node.js code step. Paste this whole file into a "Run Node.js code" step.
// Props appear in the step UI. The trigger event is read from steps.trigger.event.

// ---- core: platform-agnostic, tested on Node.js (see step.test.mjs) ----
const DOC_URL = 'https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf';
const DEFAULT_BASE_URL = 'https://api.signatureapi.com';

function requireTestKey(apiKey) {
  if (!apiKey) throw new Error('Set the signatureapi_key prop to a test key (key_test_...).');
  if (!String(apiKey).startsWith('key_test_')) throw new Error('This example runs in test mode only. Use a key that starts with key_test_.');
}

function buildEnvelopePayload(event) {
  return {
    title: `Service Agreement - ${event.name}`,
    message: 'Please review and sign the service agreement.',
    metadata: { source: 'pipedream', record_id: String(event.id) },
    topics: ['no_code', 'pipedream'],
    documents: [
      {
        key: 'service_agreement',
        url: DOC_URL,
        format: 'pdf',
        fixed_positions: [{ place_key: 'signer_signature', page: 1, top: 172, left: 210 }],
        places: [{ key: 'signer_signature', type: 'signature', recipient_key: 'signer' }],
      },
    ],
    recipients: [{ type: 'signer', key: 'signer', name: event.name, email: event.email }],
  };
}

async function createEnvelope(cfg, payload) {
  requireTestKey(cfg.apiKey);
  const response = await fetch(`${(cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')}/v1/envelopes`, {
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

// ---- Pipedream shim: defineComponent, props, steps and $ come from Pipedream ----
export default defineComponent({
  props: {
    signatureapi_key: { type: 'string', label: 'SignatureAPI test API key', secret: true },
    base_url: { type: 'string', label: 'API base URL (optional)', optional: true },
  },
  async run({ steps, $ }) {
    const event = steps.trigger.event.body ?? steps.trigger.event;
    const envelope = await createEnvelope({ apiKey: this.signatureapi_key, baseUrl: this.base_url }, buildEnvelopePayload(event));
    $.export('envelope_id', envelope.id);
    $.export('status', envelope.status);
    return { id: envelope.id, status: envelope.status };
  },
});
