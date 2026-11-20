// Tutorial app: send a contract, sign it in an embedded ceremony, track it with webhooks.
// Zero dependencies (Node 20+). Run: node server.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { NotReadyError, api, createSigningSession, downloadSignedPdf, getConfig, verifyWebhook } from './signatureapi.mjs';

const INDEX = new URL('./public/index.html', import.meta.url);

export function createApp(config) {
  // In production these live in your database. Keys: envelope id. Values: what the webhooks told us.
  const contracts = new Map();
  const seenWebhookIds = new Set();

  async function readBody(req) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    return raw;
  }

  function send(res, status, body, type = 'application/json') {
    res.writeHead(status, { 'Content-Type': type });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, await readFile(INDEX, 'utf8'), 'text/html; charset=utf-8');
    }

    // Step 1: your server creates the envelope and hands the ceremony URL to the browser.
    if (req.method === 'POST' && url.pathname === '/api/contracts') {
      const { name, email } = JSON.parse((await readBody(req)) || '{}');
      if (!name || !email) return send(res, 422, { error: 'name and email are required' });
      const userId = `usr_${randomUUID().slice(0, 8)}`; // your signed-in user's id
      const session = await createSigningSession(config, { name, email, userId });
      contracts.set(session.envelopeId, { status: 'in_progress', events: [] });
      return send(res, 201, session);
    }

    // Step 4: read the real state from your store (fed by webhooks), falling back to the API.
    const statusMatch = url.pathname.match(/^\/api\/contracts\/([0-9a-f-]{36})$/);
    if (req.method === 'GET' && statusMatch) {
      const envelope = await api(config, 'GET', `/v1/envelopes/${statusMatch[1]}`);
      return send(res, 200, { envelopeId: envelope.id, status: envelope.status, webhookEvents: contracts.get(envelope.id)?.events ?? [] });
    }

    // Step 5: stream the signed PDF through your server, so the browser never needs your API key.
    const pdfMatch = url.pathname.match(/^\/api\/contracts\/([0-9a-f-]{36})\/signed\.pdf$/);
    if (req.method === 'GET' && pdfMatch) {
      try {
        const pdf = await downloadSignedPdf(config, pdfMatch[1]);
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="signed-service-agreement.pdf"' });
        return res.end(pdf);
      } catch (error) {
        if (error instanceof NotReadyError) return send(res, 409, { error: error.message });
        throw error;
      }
    }

    // Step 3: SignatureAPI calls this endpoint. Verify the raw body before trusting it.
    if (req.method === 'POST' && url.pathname === '/webhooks/signatureapi') {
      const raw = await readBody(req);
      let event;
      try {
        event = verifyWebhook(config.webhookSecret, req.headers, raw);
      } catch (error) {
        return send(res, 400, { error: error.message });
      }
      const webhookId = req.headers['webhook-id'];
      if (seenWebhookIds.has(webhookId)) return send(res, 200, { duplicate: true });
      seenWebhookIds.add(webhookId);
      const envelopeId = event.data?.envelope_id;
      const record = contracts.get(envelopeId) ?? { status: 'unknown', events: [] };
      record.events.push(event.type);
      if (event.type === 'envelope.completed') record.status = 'completed';
      contracts.set(envelopeId, record);
      console.log(`webhook ${event.type} for envelope ${envelopeId}`);
      return send(res, 200, { received: true });
    }

    return send(res, 404, { error: 'not found' });
  }

  return createServer((req, res) => {
    handle(req, res).catch((error) => send(res, error.status && error.status < 500 ? 502 : 500, { error: error.message }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = getConfig();
  const port = Number(process.env.PORT || 3000);
  createApp(config).listen(port, () => console.log(`Tutorial app on http://localhost:${port}`));
}
