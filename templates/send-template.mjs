// Upload a DOCX template and create a test-mode envelope from it (Node.js)
// Zero dependencies. Needs Node.js 20 or newer (built-in fetch).
// Usage: node send-template.mjs <template-folder-name-or-path>
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DEFAULT_BASE_URL = 'https://api.signatureapi.com';

/** Reads the configuration from the environment. Test keys only. */
export function config(env = process.env) {
  const key = env.SIGNATUREAPI_KEY;
  if (!key) throw new Error('Set SIGNATUREAPI_KEY to a test API key (key_test_...).');
  if (!key.startsWith('key_test_')) throw new Error('This example runs in test mode only. Use a key that starts with key_test_.');
  return { key, baseUrl: (env.SIGNATUREAPI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '') };
}

async function call(cfg, method, route, { json, raw, contentType } = {}) {
  const headers = { 'X-API-Key': cfg.key };
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (raw !== undefined) {
    headers['Content-Type'] = contentType;
    body = raw;
  }
  const response = await fetch(cfg.baseUrl + route, { method, headers, body });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) throw new Error(`${method} ${route} failed with ${response.status}: ${data?.detail ?? data?.title ?? text}`);
  return data;
}

/** Builds the CreateEnvelope request body from a template folder's files. Pure: no network. */
export function buildEnvelope({ envelope, data, uploadUrl }) {
  const { document: doc, places, recipients, title, message } = envelope;
  return {
    title,
    message,
    deliverable: { type: 'standard' },
    documents: [{ key: doc.key, url: uploadUrl, format: 'docx', data, places }],
    recipients,
  };
}

export function folderPath(arg) {
  if (!arg) throw new Error('Pass a template folder, for example: node send-template.mjs offer-letter');
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.resolve(arg), path.join(here, arg)]) {
    if (existsSync(path.join(candidate, 'template.docx'))) return candidate;
  }
  throw new Error(`No template.docx found for "${arg}".`);
}

export async function send(cfg, folder) {
  const envelope = JSON.parse(await readFile(path.join(folder, 'envelope.json'), 'utf8'));
  const data = JSON.parse(await readFile(path.join(folder, 'sample-data.json'), 'utf8'));
  const file = await readFile(path.join(folder, 'template.docx'));
  const upload = await call(cfg, 'POST', '/v1/uploads', { raw: file, contentType: DOCX_TYPE });
  return call(cfg, 'POST', '/v1/envelopes', { json: buildEnvelope({ envelope, data, uploadUrl: upload.url }) });
}

async function main() {
  const cfg = config();
  const result = await send(cfg, folderPath(process.argv[2]));
  console.log(`Created envelope ${result.id} (status: ${result.status})`);
  for (const r of result.recipients ?? []) console.log(`  recipient ${r.key}: ${r.type} (${r.id})`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
