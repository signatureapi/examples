import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectOperations, generate, SAMPLE_BODIES } from '../generate.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const documented = JSON.parse(await readFile(join(ROOT, 'documented-operations.json'), 'utf8'));

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

describe('committed collections', () => {
  test('JSON collections parse and use the test-mode placeholder key only', async () => {
    for (const file of ['postman/signatureapi.postman_collection.json', 'postman/test-mode.postman_environment.json', 'insomnia/signatureapi.insomnia.json']) {
      const text = await readFile(join(ROOT, file), 'utf8');
      JSON.parse(text);
      assert.doesNotMatch(text, /key_(test|live)_[A-Za-z0-9]{9,}/, `${file} must not contain a real key`);
    }
  });
  test('Postman collection lists every documented operation once', async () => {
    const postman = JSON.parse(await readFile(join(ROOT, 'postman/signatureapi.postman_collection.json'), 'utf8'));
    const count = postman.item.reduce((n, folder) => n + folder.item.length, 0);
    assert.equal(count, documented.operations.length);
    assert.equal(postman.auth.apikey.find((p) => p.key === 'key').value, 'X-API-Key');
  });
  test('every Bruno request file declares meta and a method block', async () => {
    const files = (await walk(join(ROOT, 'bruno'))).filter((f) => f.endsWith('.bru') && !f.includes('environments') && !f.endsWith('collection.bru'));
    assert.equal(files.length, documented.operations.length);
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      assert.match(text, /^meta \{/, relative(ROOT, file));
      assert.match(text, /^(get|post|patch|delete|put) \{/m, relative(ROOT, file));
    }
  });
});

// Needs the public bundle as JSON: OPENAPI_BUNDLE=/path/to/openapi.json (CI converts the published YAML).
const withBundle = process.env.OPENAPI_BUNDLE ? describe : describe.skip;
withBundle('against the OpenAPI bundle (OPENAPI_BUNDLE set)', () => {
  test('every documented operation exists in the spec', async () => {
    const bundle = JSON.parse(await readFile(process.env.OPENAPI_BUNDLE, 'utf8'));
    const ops = collectOperations(bundle, new Set(documented.operations));
    assert.deepEqual(ops.map((o) => o.id).sort(), [...documented.operations].sort());
  });
  test('every sample body uses declared properties and sets the required ones', async () => {
    const bundle = JSON.parse(await readFile(process.env.OPENAPI_BUNDLE, 'utf8'));
    const deref = (node) => {
      let cur = node;
      while (cur && cur.$ref) cur = cur.$ref.split('/').slice(1).reduce((acc, key) => acc[key], bundle);
      return cur;
    };
    for (const item of Object.values(bundle.paths)) {
      for (const op of Object.values(item)) {
        const schema = op?.requestBody?.content?.['application/json']?.schema;
        if (!schema || !documented.operations.includes(op.operationId)) continue;
        const body = SAMPLE_BODIES[op.operationId];
        assert.ok(body, `missing sample body for ${op.operationId}`);
        const resolved = deref(schema);
        const variants = resolved.oneOf ? resolved.oneOf.map(deref) : [resolved];
        const fits = variants.some((v) => {
          const props = Object.keys(v.properties || {});
          return Object.keys(body).every((k) => props.includes(k)) && (v.required || []).every((k) => k in body);
        });
        assert.ok(fits, `${op.operationId} sample body does not fit its schema`);
      }
    }
  });
  test('committed files match a fresh generation (no drift)', async () => {
    const bundle = JSON.parse(await readFile(process.env.OPENAPI_BUNDLE, 'utf8'));
    const out = await mkdtemp(join(tmpdir(), 'collections-'));
    await generate({ bundle, documented, out });
    for (const file of await walk(out)) {
      const rel = relative(out, file);
      assert.equal(await readFile(join(ROOT, rel), 'utf8'), await readFile(file, 'utf8'), `${rel} is stale: run node generate.mjs`);
    }
  });
});
