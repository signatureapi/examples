import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const read = (f) => fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ENVELOPE_ID = 'eb4cf433-a8af-4161-b37b-7ef57d423e56';

// Load Core.gs (and optionally Code.gs) the way Apps Script does: one shared global scope.
function load(files, globals = {}) {
  const context = vm.createContext({ console, JSON, String, Error, RegExp, ...globals });
  for (const f of files) vm.runInContext(read(f), context, { filename: f });
  return context;
}

// ---------- core (platform-agnostic) ----------

test('core: builds a valid envelope payload from a sheet row', () => {
  const c = load(['Core.gs']);
  const p = c.buildEnvelopePayload_({ name: 'Jane Doe', email: 'jane.doe@example.com', rowNumber: 2 });
  assert.equal(p.documents[0].format, 'pdf');
  assert.equal(p.recipients[0].email, 'jane.doe@example.com');
  assert.equal(p.recipients[0].key, p.documents[0].places[0].recipient_key);
  assert.equal(p.documents[0].fixed_positions[0].place_key, p.documents[0].places[0].key);
  assert.deepEqual(Object.keys(p.metadata), ['source', 'sheet_row']);
  assert.ok(!JSON.stringify(p).includes(String.fromCharCode(0x2014)));
});

test('core: pendingRows_ picks rows without an envelope id', () => {
  const c = load(['Core.gs']);
  const rows = c.pendingRows_([
    ['name', 'email', 'role', 'envelope_id', 'status'],
    ['Jane Doe', 'jane.doe@example.com', 'Designer', '', ''],
    ['John Smith', 'john.smith@example.com', 'Engineer', ENVELOPE_ID, 'processing'],
    ['', '', '', '', ''],
    ['Maria Garcia', 'maria.garcia@example.com', 'Lead', '', ''],
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map((r) => r.rowNumber))), [2, 5]);
  assert.throws(() => c.pendingRows_([['name', 'email']]), /Missing column/);
});

test('core: refuses a missing or live key', () => {
  const c = load(['Core.gs']);
  assert.throws(() => c.requireTestKey_(''), /SIGNATUREAPI_KEY/);
  assert.throws(() => c.requireTestKey_('key_live_fake'), /test mode only/);
});

test('core: rowsToRefresh_ picks rows whose envelope can still change', () => {
  const c = load(['Core.gs']);
  const rows = c.rowsToRefresh_([
    ['name', 'email', 'role', 'envelope_id', 'status'],
    ['Jane Doe', 'jane.doe@example.com', 'Designer', '', ''],
    ['John Smith', 'john.smith@example.com', 'Engineer', ENVELOPE_ID, 'in_progress'],
    ['Maria Garcia', 'maria.garcia@example.com', 'Lead', ENVELOPE_ID, 'completed'],
    ['Alex Chen', 'alex.chen@example.com', 'Analyst', ENVELOPE_ID, 'canceled'],
    ['Sam Lee', 'sam.lee@example.com', 'Ops', ENVELOPE_ID, 'error: GET failed'],
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map((r) => r.rowNumber))), [3, 6]);
  assert.equal(rows[0].statusCol, 4);
  assert.throws(() => c.rowsToRefresh_([['name', 'email']]), /Missing column/);
});

test('core: getEnvelope_ refuses anything but an envelope UUID', () => {
  const c = load(['Core.gs']);
  assert.throws(() => c.getEnvelope_('key_test_fake', '../../x', () => assert.fail('no request')), /Not an envelope id/);
});

test('core: createEnvelope_ sends the key header and JSON body through the injected http function', () => {
  const c = load(['Core.gs']);
  const calls = [];
  const fake = (url, opts) => {
    calls.push({ url, opts });
    return { status: 201, body: JSON.stringify({ id: ENVELOPE_ID, status: 'processing' }) };
  };
  const payload = c.buildEnvelopePayload_({ name: 'Jane Doe', email: 'jane.doe@example.com', rowNumber: 2 });
  const env = c.createEnvelope_('key_test_fake', payload, fake);
  assert.equal(env.id, ENVELOPE_ID);
  assert.equal(calls[0].url, 'https://api.signatureapi.com/v1/envelopes');
  assert.equal(calls[0].opts.headers['X-API-Key'], 'key_test_fake');
  assert.equal(calls[0].opts.contentType, 'application/json');
  assert.deepEqual(JSON.parse(calls[0].opts.body), JSON.parse(JSON.stringify(payload)));
});

test('core: an API error becomes a readable exception', () => {
  const c = load(['Core.gs']);
  const fake = () => ({ status: 422, body: JSON.stringify({ title: 'Unprocessable', detail: 'recipients[0].email is invalid' }) });
  assert.throws(() => c.createEnvelope_('key_test_fake', {}, fake), /422: recipients\[0\]\.email is invalid/);
});

// ---------- shim (Code.gs) against fakes of the Google services ----------

function fakeSheet(values) {
  const writes = [];
  return {
    writes,
    values,
    getDataRange: () => ({ getValues: () => values.map((r) => [...r]) }),
    getRange: (row, col, nr = 1, nc = 1) => ({
      setValues: (v) => v.forEach((r, i) => r.forEach((x, j) => { values[row - 1 + i][col - 1 + j] = x; writes.push([row + i, col + j, x]); })),
      setValue: (x) => { values[row - 1][col - 1] = x; writes.push([row, col, x]); },
    }),
  };
}

function shimContext(sheet, responder, extra = {}) {
  return load(['Core.gs', 'Code.gs'], {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'key_test_fake' }) },
    SpreadsheetApp: { getActiveSheet: () => sheet, getActiveSpreadsheet: () => ({ getSheets: () => [sheet] }) },
    Utilities: { sleep: () => {} },
    ...extra,
    UrlFetchApp: {
      fetch: (url, params) => {
        const r = responder(url, params);
        return { getResponseCode: () => r.status, getContentText: () => JSON.stringify(r.body) };
      },
    },
  });
}

test('shim: sendEnvelopesFromSheet writes the envelope id and status back to the row', () => {
  const sheet = fakeSheet([
    ['name', 'email', 'role', 'envelope_id', 'status'],
    ['Jane Doe', 'jane.doe@example.com', 'Designer', '', ''],
    ['John Smith', 'john.smith@example.com', 'Engineer', ENVELOPE_ID, 'in_progress'],
  ]);
  const seen = [];
  const c = shimContext(sheet, (url, params) => {
    seen.push({ url, params });
    return { status: 201, body: { id: ENVELOPE_ID, status: 'processing' } };
  });
  c.sendEnvelopesFromSheet();
  assert.equal(seen.length, 1, 'only the row without an envelope id is sent');
  assert.equal(seen[0].params.muteHttpExceptions, true);
  assert.equal(sheet.values[1][3], ENVELOPE_ID);
  assert.equal(sheet.values[1][4], 'processing');
});

test('shim: a failing row gets an error status and the loop continues', () => {
  const sheet = fakeSheet([
    ['name', 'email', 'role', 'envelope_id', 'status'],
    ['Jane Doe', 'bad', 'Designer', '', ''],
    ['Maria Garcia', 'maria.garcia@example.com', 'Lead', '', ''],
  ]);
  let n = 0;
  const c = shimContext(sheet, () => (++n === 1 ? { status: 422, body: { detail: 'bad email' } } : { status: 201, body: { id: ENVELOPE_ID, status: 'processing' } }));
  c.sendEnvelopesFromSheet();
  assert.match(sheet.values[1][4], /^error: .*bad email/);
  assert.equal(sheet.values[2][3], ENVELOPE_ID);
});

test('shim: refreshStatuses writes the current status of every open envelope and skips final rows', () => {
  const OTHER_ID = '7d0c2b6e-3f4a-4c1d-9e8b-2a5f6c7d8e9f';
  const sheet = fakeSheet([
    ['name', 'email', 'role', 'envelope_id', 'status'],
    ['Jane Doe', 'jane.doe@example.com', 'Designer', ENVELOPE_ID, 'in_progress'],
    ['John Smith', 'john.smith@example.com', 'Engineer', OTHER_ID, 'completed'],
    ['Maria Garcia', 'maria.garcia@example.com', 'Lead', '', ''],
  ]);
  const urls = [];
  const c = shimContext(sheet, (url) => {
    urls.push(url);
    return { status: 200, body: { id: ENVELOPE_ID, status: 'completed' } };
  });
  c.refreshStatuses();
  assert.deepEqual(urls, [`https://api.signatureapi.com/v1/envelopes/${ENVELOPE_ID}`]);
  assert.equal(sheet.values[1][4], 'completed');
  assert.equal(sheet.values[2][4], 'completed', 'a final row is left as it was');
  assert.equal(sheet.values[3][4], '', 'a row without an envelope is left as it was');
});

test('shim: a failing read gets an error status and the refresh continues', () => {
  const OTHER_ID = '7d0c2b6e-3f4a-4c1d-9e8b-2a5f6c7d8e9f';
  const sheet = fakeSheet([
    ['name', 'email', 'role', 'envelope_id', 'status'],
    ['Jane Doe', 'jane.doe@example.com', 'Designer', ENVELOPE_ID, 'in_progress'],
    ['John Smith', 'john.smith@example.com', 'Engineer', OTHER_ID, 'in_progress'],
  ]);
  const c = shimContext(sheet, (url) => (url.endsWith(ENVELOPE_ID) ? { status: 404, body: { title: 'Not Found' } } : { status: 200, body: { id: OTHER_ID, status: 'completed' } }));
  c.refreshStatuses();
  assert.match(sheet.values[1][4], /^error: .*404/);
  assert.equal(sheet.values[2][4], 'completed');
});

test('shim: installRefreshTrigger creates an hourly time-driven trigger for refreshStatuses', () => {
  const calls = [];
  const builder = {
    timeBased: () => { calls.push('timeBased'); return builder; },
    everyHours: (n) => { calls.push(`everyHours:${n}`); return builder; },
    create: () => { calls.push('create'); return {}; },
  };
  const c = shimContext(fakeSheet([['name', 'email', 'role', 'envelope_id', 'status']]), () => assert.fail('no request'), {
    ScriptApp: { newTrigger: (fn) => { calls.push(`newTrigger:${fn}`); return builder; } },
  });
  c.installRefreshTrigger();
  assert.deepEqual(calls, ['newTrigger:refreshStatuses', 'timeBased', 'everyHours:1', 'create']);
});

// ---------- live: skipped unless SIGNATUREAPI_KEY is set ----------

test(
  'live: the core creates a test-mode envelope and reads it back',
  { skip: process.env.SIGNATUREAPI_KEY ? false : 'SIGNATUREAPI_KEY is not set, live test skipped' },
  async () => {
    const c = load(['Core.gs']);
    // UrlFetchApp is synchronous. Bridge it with a child Node process so the real core code runs unchanged.
    const syncHttp = (url, opts) => {
      const script = `const o = JSON.parse(process.env.REQ);
        fetch(o.url, { method: o.method, headers: { ...o.headers, ...(o.contentType ? { 'Content-Type': o.contentType } : {}) }, body: o.body })
          .then(async (r) => process.stdout.write(JSON.stringify({ status: r.status, body: await r.text() })));`;
      const r = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, REQ: JSON.stringify({ url, ...opts }) }, encoding: 'utf8' });
      return JSON.parse(r.stdout);
    };
    const payload = c.buildEnvelopePayload_({ name: 'Jane Doe', email: 'jane.doe@example.com', rowNumber: 2 });
    const base = process.env.SIGNATUREAPI_BASE_URL || undefined;
    const envelope = c.createEnvelope_(process.env.SIGNATUREAPI_KEY, payload, syncHttp, base);
    assert.match(envelope.id, UUID);
    const again = c.getEnvelope_(process.env.SIGNATUREAPI_KEY, envelope.id, syncHttp, base);
    assert.equal(again.id, envelope.id);
  },
);
