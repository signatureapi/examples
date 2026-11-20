// The two pieces of SignatureAPI logic the tutorial app needs: an API client and webhook verification.
import { createHmac, timingSafeEqual } from 'node:crypto';

export function getConfig(env = process.env) {
  const apiKey = env.SIGNATUREAPI_KEY;
  if (!apiKey || !apiKey.startsWith('key_test_')) {
    throw new Error('Set SIGNATUREAPI_KEY to a test API key (it starts with key_test_).');
  }
  return {
    apiKey,
    baseUrl: (env.SIGNATUREAPI_BASE_URL || 'https://api.signatureapi.com').replace(/\/+$/, ''),
    webhookSecret: env.SIGNATUREAPI_WEBHOOK_SECRET || '',
    appOrigin: env.APP_ORIGIN || 'http://localhost:3000',
  };
}

export async function api(config, method, path, json) {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: { 'X-API-Key': config.apiKey, Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`SignatureAPI returned ${response.status}: ${body?.detail || body?.title || 'error'}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

/**
 * Envelope for an embedded ceremony: custom authentication (your app already signed the user in),
 * embeddable_in set to your origin, and delivery_type "none" because your app shows the result.
 */
export function buildContract({ name, email, userId, appOrigin }) {
  return {
    title: 'Service Agreement',
    metadata: { app_user_id: userId },
    documents: [
      {
        url: 'https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf',
        format: 'pdf',
        places: [{ key: 'client_signature', type: 'signature', recipient_key: 'client' }],
        fixed_positions: [{ place_key: 'client_signature', page: 1, top: 172, left: 210 }],
      },
    ],
    recipients: [
      {
        key: 'client',
        type: 'signer',
        name,
        email,
        delivery_type: 'none',
        ceremony: {
          authentication: [{ type: 'custom', provider: 'Acme Corp Portal', data: { user_id: userId } }],
          embeddable_in: [appOrigin],
        },
      },
    ],
  };
}

/**
 * Creates the envelope and waits until it is in_progress: the ceremony opens only after the
 * envelope leaves `processing`. Each read returns a fresh ceremony URL for the same ceremony.
 */
export async function createSigningSession(config, { name, email, userId }) {
  let envelope = await api(config, 'POST', '/v1/envelopes', buildContract({ name, email, userId, appOrigin: config.appOrigin }));
  for (let attempt = 0; envelope.status === 'processing' && attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    envelope = await api(config, 'GET', `/v1/envelopes/${envelope.id}`);
  }
  if (envelope.status !== 'in_progress') throw new Error(`Envelope is ${envelope.status}, not ready for signing`);
  return { envelopeId: envelope.id, ceremonyUrl: envelope.recipients[0].ceremony.url };
}

/** Error for a deliverable that is not ready yet. The app answers 409 and the user tries again. */
export class NotReadyError extends Error {}

/**
 * Downloads the signed PDF of a completed envelope. The deliverable URL is pre-signed and expires
 * after 1 hour, so fetch a fresh one each time instead of storing it. It needs no API key.
 */
export async function downloadSignedPdf(config, envelopeId) {
  const envelope = await api(config, 'GET', `/v1/envelopes/${envelopeId}`);
  if (envelope.status !== 'completed' || !envelope.deliverable) {
    throw new NotReadyError(`Envelope is ${envelope.status}. The signed PDF exists once it is completed.`);
  }
  const deliverable = await api(config, 'GET', `/v1/deliverables/${envelope.deliverable.id}`);
  if (deliverable.status !== 'generated') {
    throw new NotReadyError(`Deliverable is ${deliverable.status}. Try again in a few seconds.`);
  }
  const response = await fetch(deliverable.url);
  if (!response.ok) throw new Error(`Download failed with ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Standard Webhooks verification. Returns the parsed event or throws. */
export function verifyWebhook(secret, headers, rawBody, { now = Math.floor(Date.now() / 1000), toleranceSeconds = 300 } = {}) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatures = headers['webhook-signature'];
  if (!id || !timestamp || !signatures) throw new Error('Missing webhook headers');
  if (!/^\d+$/.test(timestamp) || Math.abs(now - Number(timestamp)) > toleranceSeconds) {
    throw new Error('Webhook timestamp outside the tolerance window');
  }
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  const valid = signatures.split(' ').some((entry) => {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!valid) throw new Error('Invalid webhook signature');
  return JSON.parse(rawBody);
}
