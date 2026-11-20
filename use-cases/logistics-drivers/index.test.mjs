import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { buildEnvelope, config, send, summarize, smsText } from './index.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

// ---------- offline: payload assertions ----------

test('the payload is internally consistent', () => {
  const p = buildEnvelope();
  assert.ok(p.title && p.title.length > 0);
  assert.ok(p.documents.length >= 1 && p.documents.length <= 10);
  assert.ok(p.recipients.length >= 1 && p.recipients.length <= 10);

  const recipientKeys = p.recipients.map((r) => r.key);
  assert.equal(new Set(recipientKeys).size, recipientKeys.length, 'recipient keys are unique');
  for (const key of recipientKeys) assert.match(key, KEY_PATTERN);

  const placeKeys = [];
  for (const doc of p.documents) {
    for (const place of doc.places ?? []) {
      placeKeys.push(place.key);
      assert.match(place.key, KEY_PATTERN);
      if ('recipient_key' in place) assert.ok(recipientKeys.includes(place.recipient_key), `unknown recipient_key ${place.recipient_key}`);
    }
    for (const fp of doc.fixed_positions ?? []) {
      const base = fp.place_key.split(':')[0];
      assert.ok((doc.places ?? []).some((pl) => pl.key === base), `fixed position for unknown place ${fp.place_key}`);
    }
    for (const place of doc.places ?? []) {
      assert.ok((doc.fixed_positions ?? []).some((fp) => fp.place_key.split(':')[0] === place.key), `place ${place.key} has no fixed position`);
    }
  }
  assert.equal(new Set(placeKeys).size, placeKeys.length, 'place keys are unique');

  for (const [k, v] of Object.entries(p.metadata ?? {})) {
    assert.match(k, /^[a-zA-Z0-9_]{1,32}$/);
    assert.ok(typeof v === 'string' && v.length >= 1 && v.length <= 1000);
  }
  assert.ok((p.metadata ? Object.keys(p.metadata).length : 0) <= 10);
  for (const t of p.topics ?? []) assert.match(t, /^[a-z][a-z0-9_]{0,31}$/);
});

test('the builder is pure and returns a fresh object each call', () => {
  const a = buildEnvelope();
  const b = buildEnvelope();
  assert.deepEqual(a, b);
  assert.notEqual(a, b);
});

test('the payload carries no secrets and no em dashes', () => {
  const text = JSON.stringify(buildEnvelope());
  assert.doesNotMatch(text, /key_(test|live)_[A-Za-z0-9]{8,}/);
  assert.ok(!text.includes('\u2014'));
});

test('use-case specific shape', () => {
  const p = buildEnvelope();
  (function check(p) {
  const r = p.recipients[0];
  assert.equal(r.ceremony.url_variant, 'short');
  assert.equal(r.ceremony.authentication[0].type, 'custom');
  assert.equal(r.delivery_type, 'none');
})(p);
});

test('config refuses a missing or non-test key', () => {
  assert.throws(() => config({}), /SIGNATUREAPI_KEY/);
  assert.throws(() => config({ SIGNATUREAPI_KEY: 'key_live_fake' }), /test mode only/);
  assert.equal(config({ SIGNATUREAPI_KEY: 'key_test_fake', SIGNATUREAPI_BASE_URL: 'http://x.test/' }).baseUrl, 'http://x.test');
});

test('smsText embeds the link once', () => {
  const t = smsText('https://sign.signatureapi.com/s/Bgnedemo');
  assert.equal(t.split('https://').length - 1, 1);
});


// ---------- offline: the whole flow against a local mock of the API ----------

const ENVELOPE_ID = 'eb4cf433-a8af-4161-b37b-7ef57d423e56';

async function withMock(fn) {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const isJson = (req.headers['content-type'] ?? '').includes('application/json');
      received.push({ method: req.method, url: req.url, headers: req.headers, raw, json: isJson ? JSON.parse(raw.toString() || 'null') : null });
      const reply = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'POST' && req.url === '/v1/uploads') {
        return reply(201, { id: 'upl_demo', url: `http://127.0.0.1:${server.address().port}/v1/uploads/upl_demo` });
      }
      if (req.method === 'POST' && req.url === '/v1/envelopes') {
        const body = JSON.parse(raw.toString());
        return reply(201, {
          id: ENVELOPE_ID,
          status: 'processing',
          recipients: body.recipients.map((r, i) => ({
            id: `re_demo${i}`,
            key: r.key,
            type: r.type,
            status: 'pending',
            ceremony: r.ceremony ? { ...r.ceremony, url: 'https://sign.signatureapi.com/s/Bgnedemodemodemo' } : undefined,
          })),
        });
      }
      if (req.method === 'GET' && req.url === `/v1/envelopes/${ENVELOPE_ID}`) {
        return reply(200, { id: ENVELOPE_ID, status: 'in_progress' });
      }
      const m = req.url.match(/^\/v1\/recipients\/(re_[a-z0-9]+)\/ceremonies$/);
      if (req.method === 'POST' && m) {
        return reply(201, { ...JSON.parse(raw.toString()), url: 'https://sign.signatureapi.com/en/start?token=demo' });
      }
      return reply(404, { title: 'not found' });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const cfg = config({ SIGNATUREAPI_KEY: 'key_test_fake', SIGNATUREAPI_BASE_URL: `http://127.0.0.1:${server.address().port}` });
    return await fn(cfg, received);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('send() runs the whole flow against a mock API', async () => {
  await withMock(async (cfg, received) => {
    const result = await send(cfg);
    assert.ok(result.envelopes.length >= 1);
    for (const e of result.envelopes) assert.match(e.id, UUID);
    for (const r of received) assert.equal(r.headers['x-api-key'], 'key_test_fake');
    const created = received.filter((r) => r.method === 'POST' && r.url === '/v1/envelopes');
    assert.equal(created.length, result.envelopes.length);
    assert.match(summarize(result), /Created envelope [0-9a-f-]{36}/);
  });
});

// ---------- live: skipped unless SIGNATUREAPI_KEY is set ----------

test(
  'live: creates a test-mode envelope and gets 201 with a UUID id',
  { skip: process.env.SIGNATUREAPI_KEY ? false : 'SIGNATUREAPI_KEY is not set, live test skipped' },
  async () => {
    const result = await send(config());
    assert.ok(result.envelopes.length >= 1);
    for (const e of result.envelopes) {
      assert.match(e.id, UUID);
      assert.ok(['processing', 'in_progress'].includes(e.status), `unexpected status ${e.status}`);
    }
    assert.ok(result.ceremonies[0].url, 'the inline custom ceremony returns its URL');
  },
);
