import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../server.mjs';
import { NotReadyError, buildContract, createSigningSession, downloadSignedPdf, getConfig, verifyWebhook } from '../signatureapi.mjs';

const vector = JSON.parse(await readFile(new URL('../../../verify-webhooks/test-vector.json', import.meta.url), 'utf8'));
const ENVELOPE_ID = 'eb4cf433-a8af-4161-b37b-7ef57d423e56';
const FAKE_KEY = ['key', 'test', 'offline'].join('_');
const DELIVERABLE_ID = 'del_5hN8sD2jKq7WxZ4mPv9Ta3';
const NEW_ENVELOPE_ID = '688d2c9f-5dbe-4bc4-bd0b-2e0459016be8';
const CEREMONY = { url: 'https://sign.signatureapi.com/en/start?token=mock' };

describe('webhook verification (shared test vector)', () => {
  for (const c of vector.cases) {
    test(c.name, () => {
      const run = () => verifyWebhook(vector.secret, c.headers, c.body, { now: vector.now });
      if (c.expect === 'valid') assert.equal(run().type, 'envelope.completed');
      else assert.throws(run);
    });
  }
});

describe('tutorial app against a mock API', () => {
  let mock;
  let app;
  let base;
  let lastEnvelope;
  before(async () => {
    mock = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      // The deliverable URL is pre-signed: no API key.
      if (req.url === '/files/signed.pdf') return res.writeHead(200, { 'Content-Type': 'application/pdf' }).end('%PDF-1.7 mock');
      res.setHeader('Content-Type', 'application/json');
      if (req.headers['x-api-key'] !== FAKE_KEY) return res.writeHead(401).end('{"title":"Unauthorized"}');
      if (req.method === 'POST' && req.url === '/v1/envelopes') {
        lastEnvelope = JSON.parse(raw);
        return res.writeHead(201).end(JSON.stringify({ id: NEW_ENVELOPE_ID, status: 'processing', recipients: [{ ceremony: CEREMONY }] }));
      }
      if (req.method === 'GET' && req.url === `/v1/envelopes/${NEW_ENVELOPE_ID}`) {
        return res.writeHead(200).end(JSON.stringify({ id: NEW_ENVELOPE_ID, status: 'in_progress', recipients: [{ ceremony: CEREMONY }] }));
      }
      if (req.method === 'GET' && req.url === `/v1/envelopes/${ENVELOPE_ID}`) {
        return res.writeHead(200).end(JSON.stringify({ id: ENVELOPE_ID, status: 'completed', deliverable: { id: DELIVERABLE_ID } }));
      }
      if (req.method === 'GET' && req.url === `/v1/deliverables/${DELIVERABLE_ID}`) {
        const fileUrl = `http://127.0.0.1:${mock.address().port}/files/signed.pdf`;
        return res.writeHead(200).end(JSON.stringify({ id: DELIVERABLE_ID, status: 'generated', url: fileUrl }));
      }
      return res.writeHead(404).end('{}');
    });
    await new Promise((r) => mock.listen(0, '127.0.0.1', r));
    const config = getConfig({
      SIGNATUREAPI_KEY: FAKE_KEY,
      SIGNATUREAPI_BASE_URL: `http://127.0.0.1:${mock.address().port}`,
      SIGNATUREAPI_WEBHOOK_SECRET: vector.secret,
      APP_ORIGIN: 'https://app.acme.example',
    });
    app = createApp(config);
    await new Promise((r) => app.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${app.address().port}`;
  });
  after(() => {
    app.close();
    mock.close();
  });

  test('serves the page with the origin check', async () => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /event\.origin !== CEREMONY_ORIGIN/);
    assert.match(html, /event_delivery/);
  });
  test('creates an embeddable envelope and returns the ceremony URL', async () => {
    const response = await fetch(`${base}/api/contracts`, { method: 'POST', body: JSON.stringify({ name: 'Jane Doe', email: 'jane.doe@example.com' }) });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.envelopeId, NEW_ENVELOPE_ID);
    assert.match(body.ceremonyUrl, /^https:\/\/sign\.signatureapi\.com\//);
    const recipient = lastEnvelope.recipients[0];
    assert.equal(recipient.delivery_type, 'none');
    assert.deepEqual(recipient.ceremony.embeddable_in, ['https://app.acme.example']);
    assert.equal(recipient.ceremony.authentication[0].type, 'custom');
  });
  test('rejects a request without name and email', async () => {
    const response = await fetch(`${base}/api/contracts`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 422);
  });
  test('accepts a signed webhook once, rejects tampering and dedupes retries', async () => {
    const valid = vector.cases.find((c) => c.name === 'valid');
    const tampered = vector.cases.find((c) => c.name === 'tampered_body');
    // The vector is signed at a fixed time; give the app a fresh signature for "now".
    const { createHmac } = await import('node:crypto');
    const ts = String(Math.floor(Date.now() / 1000));
    const key = Buffer.from(vector.secret.slice(6), 'base64');
    const sig = `v1,${createHmac('sha256', key).update(`${valid.headers['webhook-id']}.${ts}.${valid.body}`).digest('base64')}`;
    const headers = { 'webhook-id': valid.headers['webhook-id'], 'webhook-timestamp': ts, 'webhook-signature': sig };
    const ok = await fetch(`${base}/webhooks/signatureapi`, { method: 'POST', headers, body: valid.body });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { received: true });
    const again = await fetch(`${base}/webhooks/signatureapi`, { method: 'POST', headers, body: valid.body });
    assert.deepEqual(await again.json(), { duplicate: true });
    const bad = await fetch(`${base}/webhooks/signatureapi`, { method: 'POST', headers: { ...headers, 'webhook-id': 'msg_other' }, body: tampered.body });
    assert.equal(bad.status, 400);
    const status = await (await fetch(`${base}/api/contracts/${ENVELOPE_ID}`)).json();
    assert.equal(status.status, 'completed');
    assert.deepEqual(status.webhookEvents, ['envelope.completed']);
  });
  test('streams the signed PDF of a completed envelope', async () => {
    const response = await fetch(`${base}/api/contracts/${ENVELOPE_ID}/signed.pdf`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.match(await response.text(), /^%PDF/);
  });
});

const live = process.env.SIGNATUREAPI_KEY ? describe : describe.skip;
live('live test mode (SIGNATUREAPI_KEY set)', () => {
  test('creates an embedded-ceremony envelope and waits until it is in_progress', { timeout: 60_000 }, async () => {
    const config = { ...getConfig(), appOrigin: 'https://app.acme.example' };
    const session = await createSigningSession(config, { name: 'Jane Doe', email: 'jane.doe@example.com', userId: 'usr_tutorial' });
    assert.match(session.envelopeId, /^[0-9a-f-]{36}$/);
    // Never print the ceremony URL: it is a bearer link for the signer.
    assert.match(session.ceremonyUrl, /^https:\/\//);
  });
  // An automatic signer completes the envelope without a person, so the download step runs for real.
  test('downloads the signed PDF of a completed envelope', { timeout: 180_000 }, async () => {
    const config = getConfig();
    const { api } = await import('../signatureapi.mjs');
    const png = await readFile(new URL('../../../scripts/assets/acme-mark.png', import.meta.url));
    const uploadResponse = await fetch(`${config.baseUrl}/v1/uploads`, {
      method: 'POST', headers: { 'X-API-Key': config.apiKey, 'Content-Type': 'image/png' }, body: png,
    });
    assert.equal(uploadResponse.status, 201);
    const upload = await uploadResponse.json();
    const body = buildContract({ name: 'Jane Doe', email: 'jane.doe@example.com', userId: 'usr_tutorial', appOrigin: 'https://app.acme.example' });
    body.recipients = [{
      key: 'client', type: 'automatic_signer', name: 'Jane Doe',
      signature: { type: 'drawn', url: upload.url },
      mandate: 'Authorized by Acme Corp board resolution 2026-04 (synthetic example)',
    }];
    const created = await api(config, 'POST', '/v1/envelopes', body);
    let pdf = null;
    for (let i = 0; i < 60 && !pdf; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      pdf = await downloadSignedPdf(config, created.id).catch((error) => {
        if (error instanceof NotReadyError) return null;
        throw error;
      });
    }
    assert.ok(pdf, 'the signed PDF was not ready within 120 seconds');
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  });
});
