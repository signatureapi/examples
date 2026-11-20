import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { test } from 'node:test';

const source = fs.readFileSync(new URL('./script.js', import.meta.url), 'utf8');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ENVELOPE_ID = 'eb4cf433-a8af-4161-b37b-7ef57d423e56';

// The core: the text between the markers, evaluated on its own.
const core = source.split('// ---- core')[1].split('// ---- end core ----')[0].replace(/^[^\n]*\n/, '');
const { buildEnvelopePayload, createEnvelope, requireTestKey } = new Function(`${core}\nreturn { buildEnvelopePayload, createEnvelope, requireTestKey };`)();

// The whole script as Airtable runs it: top-level await with input, output and fetch in scope.
// The key is a script secret, read with input.secret(), never an input variable.
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
async function runScript(config, fetchFn, secrets = {}) {
  const outputs = {};
  const input = {
    config: () => config,
    secret: (name) => {
      if (!(name in secrets)) throw new Error(`No secret named ${name}`);
      return secrets[name];
    },
  };
  const output = { set: (k, v) => { outputs[k] = v; } };
  await new AsyncFunction('input', 'output', 'fetch', source)(input, output, fetchFn);
  return outputs;
}

test('core: the payload is a valid-shaped envelope with one signer and one place', () => {
  const p = buildEnvelopePayload({ name: 'Jane Doe', email: 'jane.doe@example.com', recordId: 'recA1B2C3' });
  assert.equal(p.documents[0].format, 'pdf');
  assert.equal(p.recipients[0].key, p.documents[0].places[0].recipient_key);
  assert.equal(p.documents[0].fixed_positions[0].place_key, p.documents[0].places[0].key);
  assert.equal(p.metadata.record_id, 'recA1B2C3');
  assert.ok(!JSON.stringify(p).includes(String.fromCharCode(0x2014)));
});

test('core: refuses a missing or live key', () => {
  assert.throws(() => requireTestKey(undefined), /secret named apiKey/);
  assert.throws(() => requireTestKey('key_live_fake'), /test mode only/);
});

test('core: an API error becomes a readable exception', async () => {
  const fake = async () => ({ ok: false, status: 422, text: async () => JSON.stringify({ detail: 'recipients[0].email is invalid' }) });
  await assert.rejects(createEnvelope({ apiKey: 'key_test_fake' }, {}, fake), /422: recipients\[0\]\.email is invalid/);
});

test('shim: the whole script reads input.config() and the apiKey secret, calls the API and sets the outputs', async () => {
  const seen = [];
  const fake = async (url, opts) => {
    seen.push({ url, opts });
    return { ok: true, status: 201, text: async () => JSON.stringify({ id: ENVELOPE_ID, status: 'processing' }) };
  };
  const outputs = await runScript({ name: 'Jane Doe', email: 'jane.doe@example.com', recordId: 'recA1B2C3' }, fake, { apiKey: 'key_test_fake' });
  assert.deepEqual(outputs, { envelope_id: ENVELOPE_ID, status: 'processing' });
  assert.equal(seen[0].url, 'https://api.signatureapi.com/v1/envelopes');
  assert.equal(seen[0].opts.headers['X-API-Key'], 'key_test_fake');
  assert.equal(JSON.parse(seen[0].opts.body).recipients[0].name, 'Jane Doe');
});

test('shim: a key passed as an input variable is not used', async () => {
  const fake = async () => assert.fail('no request without the secret');
  await assert.rejects(runScript({ apiKey: 'key_test_fake', name: 'Jane Doe', email: 'jane.doe@example.com', recordId: 'recA1B2C3' }, fake, { apiKey: '' }), /secret named apiKey/);
});

test('shim: the script works end to end against a local mock HTTP server using real fetch', async () => {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ url: req.url, key: req.headers['x-api-key'], body: JSON.parse(Buffer.concat(chunks).toString()) });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: ENVELOPE_ID, status: 'processing' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const outputs = await runScript({ baseUrl: `http://127.0.0.1:${server.address().port}`, name: 'Maria Garcia', email: 'maria.garcia@example.com', recordId: 'recX' }, fetch, { apiKey: 'key_test_fake' });
    assert.equal(outputs.envelope_id, ENVELOPE_ID);
    assert.equal(received[0].url, '/v1/envelopes');
    assert.equal(received[0].key, 'key_test_fake');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test(
  'live: the script creates a test-mode envelope (201 and a UUID id)',
  { skip: process.env.SIGNATUREAPI_KEY ? false : 'SIGNATUREAPI_KEY is not set, live test skipped' },
  async () => {
    const outputs = await runScript(
      { baseUrl: process.env.SIGNATUREAPI_BASE_URL, name: 'Jane Doe', email: 'jane.doe@example.com', recordId: 'recLive1' },
      fetch,
      { apiKey: process.env.SIGNATUREAPI_KEY },
    );
    assert.match(outputs.envelope_id, UUID);
  },
);
