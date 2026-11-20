import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { api, ApiError, buildServiceAgreement, getConfig } from '../lib.mjs';
import { sendEnvelope } from '../send-envelope.mjs';
import { getEnvelope } from '../get-status.mjs';
import { downloadDeliverable } from '../download-deliverable.mjs';
import { bulkSend, parseCsv } from '../bulk-send-csv.mjs';

const ENVELOPE_ID = 'eb4cf433-a8af-4161-b37b-7ef57d423e56';
const DELIVERABLE_ID = 'del_5hN8sD2jKq7WxZ4mPv9Ta3';
const FAKE_KEY = ['key', 'test', 'offline'].join('_');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('config', () => {
  test('requires a key', () => {
    assert.throws(() => getConfig({}), /SIGNATUREAPI_KEY/);
  });
  test('refuses live keys', () => {
    assert.throws(() => getConfig({ SIGNATUREAPI_KEY: ['key', 'live', 'x'].join('_') }), /test mode only/);
  });
  test('defaults the base URL and trims trailing slashes', () => {
    assert.equal(getConfig({ SIGNATUREAPI_KEY: FAKE_KEY }).baseUrl, 'https://api.signatureapi.com');
    assert.equal(getConfig({ SIGNATUREAPI_KEY: FAKE_KEY, SIGNATUREAPI_BASE_URL: 'http://x/' }).baseUrl, 'http://x');
  });
});

describe('payload', () => {
  test('the signature place has a fixed position for the signer', () => {
    const body = buildServiceAgreement();
    assert.equal(body.recipients[0].type, 'signer');
    assert.equal(body.recipients[0].email, 'jane.doe@example.com');
    const [doc] = body.documents;
    assert.equal(doc.places[0].recipient_key, body.recipients[0].key);
    assert.equal(doc.fixed_positions[0].place_key, doc.places[0].key);
  });
  test('parses quoted CSV values', () => {
    const rows = parseCsv('name,email,customer_ref\n"Doe, Jane",jane.doe@example.com,ACME-1\n\n');
    assert.deepEqual(rows, [{ name: 'Doe, Jane', email: 'jane.doe@example.com', customer_ref: 'ACME-1' }]);
  });
});

describe('against a local mock API', () => {
  let server;
  let config;
  const seen = [];
  before(async () => {
    server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      seen.push({ method: req.method, url: req.url, key: req.headers['x-api-key'], body: raw ? JSON.parse(raw) : null });
      const base = `http://127.0.0.1:${server.address().port}`;
      const reply = (status, body, type = 'application/json') => {
        res.writeHead(status, { 'Content-Type': type });
        res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
      };
      // The pre-signed deliverable URL needs no API key, and the script must not leak it there.
      if (req.url === '/signed.pdf') {
        return req.headers['x-api-key'] ? reply(400, 'key leaked', 'text/plain') : reply(200, '%PDF-1.4 mock', 'application/pdf');
      }
      if (req.headers['x-api-key'] !== FAKE_KEY) return reply(401, { title: 'Unauthorized', detail: 'Invalid API key' });
      if (req.method === 'POST' && req.url === '/v1/envelopes') {
        const body = JSON.parse(raw);
        if (body.recipients[0].email === 'bad@example.com') {
          return reply(422, { title: 'Unprocessable Entity', detail: 'Invalid email', errors: [] });
        }
        return reply(201, { id: ENVELOPE_ID, status: 'processing', recipients: body.recipients.map((r) => ({ ...r, status: 'pending' })) });
      }
      if (req.method === 'GET' && req.url === `/v1/envelopes/${ENVELOPE_ID}`) {
        return reply(200, { id: ENVELOPE_ID, status: 'completed', recipients: [], deliverable: { id: DELIVERABLE_ID, status: 'generated' } });
      }
      if (req.method === 'GET' && req.url === `/v1/deliverables/${DELIVERABLE_ID}`) {
        return reply(200, { id: DELIVERABLE_ID, status: 'generated', url: `${base}/signed.pdf` });
      }
      return reply(404, { title: 'Not Found' });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    config = { apiKey: FAKE_KEY, baseUrl: `http://127.0.0.1:${server.address().port}` };
  });
  after(() => server.close());

  test('send posts the envelope with the API key', async () => {
    const envelope = await sendEnvelope(config, { name: 'Jane Doe', email: 'jane.doe@example.com' });
    assert.equal(envelope.id, ENVELOPE_ID);
    const call = seen.at(-1);
    assert.equal(call.method, 'POST');
    assert.equal(call.url, '/v1/envelopes');
    assert.equal(call.body.title, 'Service Agreement');
  });
  test('status reads the envelope', async () => {
    const envelope = await getEnvelope(config, ENVELOPE_ID);
    assert.equal(envelope.status, 'completed');
  });
  test('download saves the deliverable PDF', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sapi-'));
    const out = join(dir, 'signed.pdf');
    const result = await downloadDeliverable(config, ENVELOPE_ID, out);
    assert.equal(result.deliverableId, DELIVERABLE_ID);
    assert.match(await readFile(out, 'utf8'), /^%PDF/);
  });
  test('API errors carry the status and detail', async () => {
    await assert.rejects(api({ ...config, apiKey: 'wrong' }, 'GET', '/v1/envelopes'), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 401);
      assert.match(error.message, /Invalid API key/);
      return true;
    });
  });
  test('bulk send keeps going after a failed row', async () => {
    const rows = parseCsv('name,email,customer_ref\nJane Doe,jane.doe@example.com,A1\nBad Row,bad@example.com,A2\nJohn Smith,john.smith@example.com,A3');
    const results = await bulkSend(config, rows, { delayMs: 0 });
    assert.deepEqual(results.map((r) => r.ok), [true, false, true]);
    assert.match(results[1].error, /422/);
  });
});

// Live test: runs only with a test key. It uses an automatic signer so the envelope
// completes without a human, then downloads the real signed PDF.
const live = process.env.SIGNATUREAPI_KEY ? describe : describe.skip;
live('live test mode (SIGNATUREAPI_KEY set)', () => {
  test('send, poll to completed, download the deliverable', { timeout: 180_000 }, async () => {
    const config = getConfig();
    const png = await readFile(new URL('../../assets/acme-mark.png', import.meta.url));
    const upload = await api(config, 'POST', '/v1/uploads', { body: png, contentType: 'image/png' });
    const body = buildServiceAgreement();
    body.title = 'Service Agreement (examples repo live test)';
    body.recipients = [
      {
        key: 'client',
        type: 'automatic_signer',
        name: 'Jane Doe',
        signature: { type: 'drawn', url: upload.url },
        mandate: 'Authorized by Acme Corp board resolution 2026-04 (synthetic example)',
      },
    ];
    const created = await api(config, 'POST', '/v1/envelopes', { json: body });
    assert.match(created.id, UUID);
    let envelope = created;
    for (let i = 0; i < 60 && !(envelope.status === 'completed' && envelope.deliverable?.status === 'generated'); i += 1) {
      assert.ok(!['failed', 'canceled'].includes(envelope.status), `envelope ${envelope.status}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      envelope = await getEnvelope(config, created.id);
    }
    assert.equal(envelope.status, 'completed');
    const dir = await mkdtemp(join(tmpdir(), 'sapi-live-'));
    const result = await downloadDeliverable(config, created.id, join(dir, 'signed.pdf'));
    assert.ok(result.bytes > 1000);
    console.log(`live: envelope ${created.id} completed, deliverable ${result.deliverableId} ${result.bytes} bytes`);
  });
  test('send to a human signer returns a pending envelope', async () => {
    const envelope = await sendEnvelope(getConfig(), { name: 'Jane Doe', email: 'jane.doe@example.com' });
    assert.match(envelope.id, UUID);
    assert.ok(['processing', 'in_progress'].includes(envelope.status));
  });
});
