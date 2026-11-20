import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getConfig, sendLocalFile, uploadFile } from '../send-local-file.mjs';

const SAMPLE = fileURLToPath(new URL('../service-agreement.pdf', import.meta.url));
const ENVELOPE_ID = 'eb4cf433-a8af-4161-b37b-7ef57d423e56';
const FAKE_KEY = ['key', 'test', 'fake'].join('_');

describe('against a local mock API', () => {
  let server;
  let config;
  const calls = [];
  before(async () => {
    server = createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks);
      calls.push({ method: req.method, url: req.url, type: req.headers['content-type'], raw });
      res.setHeader('Content-Type', 'application/json');
      if (req.headers['x-api-key'] !== FAKE_KEY) return res.writeHead(401).end('{"title":"Unauthorized"}');
      if (req.url === '/v1/uploads') {
        return res.writeHead(201).end(JSON.stringify({ id: 'upl_2bC6tF9gHk3LmQ8rSx5Vy7', url: 'https://api.signatureapi.com/v1/uploads/upl_2bC6tF9gHk3LmQ8rSx5Vy7' }));
      }
      if (req.url === '/v1/envelopes') return res.writeHead(201).end(JSON.stringify({ id: ENVELOPE_ID, status: 'processing' }));
      return res.writeHead(404).end('{}');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    config = { apiKey: FAKE_KEY, baseUrl: `http://127.0.0.1:${server.address().port}` };
  });
  after(() => server.close());

  test('uploads the raw bytes, then creates the envelope from the upload url', async () => {
    const envelope = await sendLocalFile(config, { path: SAMPLE, name: 'Jane Doe', email: 'jane.doe@example.com' });
    assert.equal(envelope.id, ENVELOPE_ID);
    const [upload, create] = calls.slice(-2);
    assert.equal(upload.type, 'application/pdf');
    assert.equal(upload.raw.subarray(0, 5).toString(), '%PDF-');
    const body = JSON.parse(create.raw.toString());
    assert.equal(body.documents[0].url, 'https://api.signatureapi.com/v1/uploads/upl_2bC6tF9gHk3LmQ8rSx5Vy7');
    assert.equal(body.documents[0].format, 'pdf');
  });
  test('rejects unsupported file types before calling the API', async () => {
    const before = calls.length;
    await assert.rejects(uploadFile(config, 'notes.txt'), /Only \.pdf and \.docx/);
    assert.equal(calls.length, before);
  });
  test('refuses live keys', () => {
    assert.throws(() => getConfig({ SIGNATUREAPI_KEY: ['key', 'live', 'x'].join('_') }), /test API key/);
  });
});

const live = process.env.SIGNATUREAPI_KEY ? describe : describe.skip;
live('live test mode (SIGNATUREAPI_KEY set)', () => {
  test('uploads the bundled PDF and creates an envelope', async () => {
    const envelope = await sendLocalFile(getConfig(), { path: SAMPLE, name: 'Jane Doe', email: 'jane.doe@example.com' });
    assert.match(envelope.id, /^[0-9a-f-]{36}$/);
  });
});
