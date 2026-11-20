import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { test } from 'node:test';

const source = fs.readFileSync(new URL('./step.mjs', import.meta.url), 'utf8');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ENVELOPE_ID = 'eb4cf433-a8af-4161-b37b-7ef57d423e56';

const core = source.split('// ---- core')[1].split('// ---- end core ----')[0].replace(/^[^\n]*\n/, '');
const { buildEnvelopePayload, createEnvelope, requireTestKey } = new Function(`${core}\nreturn { buildEnvelopePayload, createEnvelope, requireTestKey };`)();

// Load the real step file with Pipedream's global defineComponent stubbed (it returns the component).
globalThis.defineComponent = (component) => component;
const component = (await import(new URL('./step.mjs', import.meta.url))).default;

function runStep(props, event, $ = { export: () => {} }) {
  return component.run.call(props, { steps: { trigger: { event } }, $ });
}

test('core: the payload is a valid-shaped envelope with one signer and one place', () => {
  const p = buildEnvelopePayload({ id: 1042, name: 'Jane Doe', email: 'jane.doe@example.com' });
  assert.equal(p.documents[0].format, 'pdf');
  assert.equal(p.recipients[0].key, p.documents[0].places[0].recipient_key);
  assert.equal(p.metadata.record_id, '1042');
  assert.ok(!JSON.stringify(p).includes(String.fromCharCode(0x2014)));
});

test('core: refuses a missing or live key', () => {
  assert.throws(() => requireTestKey(undefined), /signatureapi_key/);
  assert.throws(() => requireTestKey('key_live_fake'), /test mode only/);
});

test('shim: the component has the documented shape (props and an async run)', () => {
  assert.equal(component.props.signatureapi_key.secret, true);
  assert.equal(typeof component.run, 'function');
});

test('shim: run() reads the trigger event, creates the envelope and exports the id', async () => {
  const exported = {};
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      assert.equal(req.headers['x-api-key'], 'key_test_fake');
      assert.equal(JSON.parse(Buffer.concat(chunks).toString()).recipients[0].email, 'john.smith@example.com');
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: ENVELOPE_ID, status: 'processing' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const result = await runStep(
      { signatureapi_key: 'key_test_fake', base_url: `http://127.0.0.1:${server.address().port}` },
      { body: { id: 7, name: 'John Smith', email: 'john.smith@example.com' } },
      { export: (k, v) => { exported[k] = v; } },
    );
    assert.deepEqual(result, { id: ENVELOPE_ID, status: 'processing' });
    assert.deepEqual(exported, { envelope_id: ENVELOPE_ID, status: 'processing' });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('shim: an API error surfaces as a failed step', async () => {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(422, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'recipients[0].email is invalid' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(
      runStep({ signatureapi_key: 'key_test_fake', base_url: `http://127.0.0.1:${server.address().port}` }, { id: 1, name: 'X', email: 'bad' }),
      /422: recipients\[0\]\.email is invalid/,
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test(
  'live: the step creates a test-mode envelope (201 and a UUID id)',
  { skip: process.env.SIGNATUREAPI_KEY ? false : 'SIGNATUREAPI_KEY is not set, live test skipped' },
  async () => {
    const result = await runStep(
      { signatureapi_key: process.env.SIGNATUREAPI_KEY, base_url: process.env.SIGNATUREAPI_BASE_URL },
      { id: 'live1', name: 'Jane Doe', email: 'jane.doe@example.com' },
    );
    assert.match(result.id, UUID);
  },
);
