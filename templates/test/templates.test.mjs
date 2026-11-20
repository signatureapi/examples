// Offline checks for every DOCX template folder, plus one live send when SIGNATUREAPI_KEY is set.
// Zero dependencies: the DOCX (a ZIP file) is read with node:zlib.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildEnvelope, config, folderPath, send } from '../send-template.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const folders = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, 'template.docx')))
  .map((d) => d.name)
  .sort();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Returns one entry of a ZIP file as a Buffer (stored or deflated entries). */
function readZipEntry(zip, name) {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  assert.ok(eocd >= 0, 'not a ZIP file');
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < zip.readUInt16LE(eocd + 10); i += 1) {
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLength = zip.readUInt16LE(p + 28);
    const next = p + 46 + nameLength + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
    if (zip.toString('utf8', p + 46, p + 46 + nameLength) === name) {
      const local = zip.readUInt32LE(p + 42);
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return method === 8 ? zlib.inflateRawSync(data) : data;
    }
    p = next;
  }
  throw new Error(`${name} not found`);
}

function documentText(folder) {
  const xml = readZipEntry(fs.readFileSync(path.join(root, folder, 'template.docx')), 'word/document.xml').toString('utf8');
  return xml.replace(/<[^>]+>/g, '');
}

/** True when a dotted path resolves in the data. Arrays resolve through their items (repeating tables). */
function resolves(data, dotted) {
  let values = [data];
  for (const part of dotted.split('.')) {
    values = values.flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => v && typeof v === 'object' && part in v).map((v) => v[part]);
    if (values.length === 0) return false;
  }
  return true;
}

function keys(value) {
  if (Array.isArray(value)) return value.flatMap(keys);
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => [k, ...keys(v)]);
  return [];
}

test('there are twelve template folders, each with its four files', () => {
  assert.equal(folders.length, 12);
  for (const f of folders) {
    for (const file of ['README.md', 'template.docx', 'sample-data.json', 'envelope.json']) {
      assert.ok(fs.existsSync(path.join(root, f, file)), `${f}/${file}`);
    }
  }
});

for (const f of folders) {
  test(`${f}: every merge field resolves in sample-data.json and every place has a placeholder`, () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(root, f, 'envelope.json'), 'utf8'));
    const data = JSON.parse(fs.readFileSync(path.join(root, f, 'sample-data.json'), 'utf8'));
    const text = documentText(f);

    const fields = [...text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]);
    assert.ok(fields.length > 0, 'the template has merge fields');
    for (const field of fields) {
      if (field === 'else' || field === 'endif') continue;
      const name = field.replace(/^if\s+/, '');
      assert.ok(resolves(data, name), `{{${field}}} has no value in sample-data.json`);
    }
    for (const k of keys(data)) assert.match(k, /^[a-zA-Z0-9]+$/, `data key "${k}" must be letters and digits only`);

    const placeholders = new Set([...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]));
    const recipientKeys = new Set(envelope.recipients.map((r) => r.key));
    for (const place of envelope.places) {
      assert.ok(placeholders.has(place.key), `[[${place.key}]] is missing from template.docx`);
      assert.ok(recipientKeys.has(place.recipient_key), `${place.key} points at an unknown recipient`);
    }
    for (const r of envelope.recipients) assert.match(r.email, /@example\.com$/);

    const body = buildEnvelope({ envelope, data, uploadUrl: 'https://api.signatureapi.com/v1/uploads/upl_sample' });
    assert.equal(body.documents[0].format, 'docx');
    assert.deepEqual(body.documents[0].data, data);
    assert.deepEqual(body.documents[0].places, envelope.places);
  });
}

test('config refuses a missing or live key, and folderPath finds a folder by name', () => {
  assert.throws(() => config({}), /SIGNATUREAPI_KEY/);
  assert.throws(() => config({ SIGNATUREAPI_KEY: 'key_live_fake' }), /test mode only/);
  assert.equal(config({ SIGNATUREAPI_KEY: 'key_test_fake', SIGNATUREAPI_BASE_URL: 'https://example.com/' }).baseUrl, 'https://example.com');
  assert.equal(folderPath('offer-letter'), path.join(root, 'offer-letter'));
  assert.throws(() => folderPath('no-such-template'), /No template.docx/);
});

test(
  'live: the offer letter uploads and creates a test-mode envelope',
  { skip: process.env.SIGNATUREAPI_KEY ? false : 'SIGNATUREAPI_KEY is not set, live test skipped' },
  async () => {
    const result = await send(config(), path.join(root, 'offer-letter'));
    assert.match(result.id, UUID);
  },
);
