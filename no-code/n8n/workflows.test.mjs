// Offline checks for the n8n workflow exports: structure, credential handling, and the Code nodes run on sample input.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const dir = new URL('./', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'package.json');
const load = (f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const require = createRequire(import.meta.url);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Runs a Code node's JavaScript the way n8n's "Run Once for All Items" mode does.
function runCode(code, { items, env = {}, binary } = {}) {
  const $input = { first: () => items[0], all: () => items };
  const helpers = { getBinaryDataBuffer: async () => binary };
  return new AsyncFunction('$input', '$env', 'require', code).call({ helpers }, $input, env, require);
}
const codeOf = (wf, name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;

function assertEnvelope(envelope) {
  assert.ok(envelope.title, 'title');
  assert.ok(envelope.documents.length > 0, 'documents');
  const signers = envelope.recipients.filter((r) => r.type === 'signer');
  assert.ok(signers.length > 0, 'at least one signing recipient');
  const places = envelope.documents.flatMap((d) => d.places ?? []);
  for (const s of signers) assert.ok(places.some((p) => p.recipient_key === s.key && p.type === 'signature'), `signature place for ${s.key}`);
  for (const r of envelope.recipients) assert.match(r.email, /@example\.com$/);
}

test('every export is a plain n8n workflow with built-in nodes only', () => {
  assert.equal(files.length, 7);
  for (const f of files) {
    const wf = load(f);
    assert.match(wf.name, /^SignatureAPI: /, f);
    for (const n of wf.nodes) assert.match(n.type, /^n8n-nodes-base\./, `${f}: ${n.name}`);
    for (const k of ['id', 'versionId', 'meta', 'active', 'shared']) assert.equal(wf[k], undefined, `${f}: top-level ${k}`);
  }
});

test('SignatureAPI calls use the Header Auth credential by name, and no ids or keys are in the files', () => {
  for (const f of files) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(text, /key_(test|live)_[A-Za-z0-9]{6,}/, `${f}: API key`);
    assert.doesNotMatch(text, /"(webhookId|instanceId)"/, `${f}: instance or webhook id`);
    for (const n of load(f).nodes.filter((x) => x.type === 'n8n-nodes-base.httpRequest' && x.parameters.url.includes('api.signatureapi.com'))) {
      assert.equal(n.parameters.authentication, 'genericCredentialType', `${f}: ${n.name}`);
      assert.equal(n.parameters.genericAuthType, 'httpHeaderAuth', `${f}: ${n.name}`);
      assert.deepEqual(n.credentials, { httpHeaderAuth: { name: 'SignatureAPI test key' } }, `${f}: ${n.name}`);
    }
  }
});

test('employment contract: HR approves, then employer and employee sign', async () => {
  const body = { reference: 'HR-1042', employee: { name: 'Maria Garcia', email: 'maria.garcia@example.com' }, job_title: 'Customer Success Manager', start_date: '2026-12-01', salary: '72,000', has_probation: true };
  const [{ json }] = await runCode(codeOf(load('employment-contract.json'), 'Build envelope'), { items: [{ json: { body } }] });
  assertEnvelope(json.envelope);
  assert.deepEqual(json.envelope.recipients.map((r) => `${r.key}:${r.type}`), ['hr:approver', 'employer:signer', 'employee:signer']);
  assert.equal(json.envelope.routing, 'sequential');
  assert.equal(json.envelope.documents[0].data.hasProbation, true);
  await assert.rejects(runCode(codeOf(load('employment-contract.json'), 'Build envelope'), { items: [{ json: { body: {} } }] }), /employee\.name/);
});

test('NDA batch and lease renewal build one envelope per due row', async () => {
  const nda = load('nda-batch.json');
  const rows = await runCode(codeOf(nda, 'Counterparties'), { items: [] });
  const envelopes = await runCode(codeOf(nda, 'Build envelopes'), { items: rows });
  assert.equal(envelopes.length, rows.length);
  for (const e of envelopes) assertEnvelope(e.json.envelope);
  assert.deepEqual(nda.nodes.find((n) => n.name === 'Create envelope').parameters.options.batching, { batch: { batchSize: 5, batchInterval: 1000 } });

  const lease = load('lease-renewal.json');
  const leases = await runCode(codeOf(lease, 'Leases'), { items: [] });
  const renewals = await runCode(codeOf(lease, 'Build renewals'), { items: leases });
  assert.equal(renewals.length, 1, 'only the lease ending within 60 days');
  assertEnvelope(renewals[0].json.envelope);
});

test('invoice approval and form to envelope build valid envelopes', async () => {
  const invoice = { invoice_number: 'INV-1001', vendor: 'Globex Example Ltd', amount: '4,250.00', currency: 'USD', pdf_url: 'https://api.signatureapi.com/v1/uploads/upl_x', approver: { name: 'Alex Chen', email: 'alex.chen@example.com' }, signer: { name: 'John Smith', email: 'john.smith@example.com' } };
  const [{ json: inv }] = await runCode(codeOf(load('invoice-approval.json'), 'Build envelope'), { items: [{ json: { body: invoice } }] });
  assertEnvelope(inv.envelope);
  assert.deepEqual(inv.envelope.recipients.map((r) => r.type), ['approver', 'signer']);

  const answers = { 'Candidate name': 'Jane Doe', 'Candidate email': 'jane.doe@example.com', Position: 'Product Designer', 'Start date': '2026-12-07', Salary: 'USD 84,000' };
  const [{ json: form }] = await runCode(codeOf(load('form-to-envelope.json'), 'Build envelope'), { items: [{ json: answers }] });
  assertEnvelope(form.envelope);
});

test('signed-PDF workflow: the Code node accepts a valid signature and refuses a changed body', async () => {
  // A throwaway secret built at runtime (Standard Webhooks format), never a real one.
  const keyBytes = crypto.randomBytes(24);
  const secret = ['wh', 'sec_'].join('') + keyBytes.toString('base64');
  const raw = Buffer.from(JSON.stringify({ type: 'deliverable.generated', data: { object_id: 'del_6FF89lKNyTNamOJCJd1tLL' } }));
  const id = 'msg_test';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac('sha256', keyBytes).update(`${id}.${timestamp}.`).update(raw).digest('base64');
  const headers = { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` };
  const code = codeOf(load('deliverable-on-completion.json'), 'Verify signature');
  const env = { SIGNATUREAPI_WEBHOOK_SECRET: secret };

  const [{ json }] = await runCode(code, { items: [{ json: { headers } }], env, binary: raw });
  assert.equal(json.event.type, 'deliverable.generated');
  await assert.rejects(runCode(code, { items: [{ json: { headers } }], env, binary: Buffer.from(raw.toString().replace('del_', 'del-')) }), /Invalid webhook signature/);
  await assert.rejects(runCode(code, { items: [{ json: { headers: { ...headers, 'webhook-timestamp': '1000000000' } } }], env, binary: raw }), /5 minutes/);
});
