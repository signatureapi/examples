// Platform-agnostic core. No Google services are used here: the HTTP call is injected.
// Tested on the host with node --test (see core.test.mjs).

var SIGNATUREAPI_DOC_URL = 'https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf';
var SIGNATUREAPI_BASE_URL = 'https://api.signatureapi.com';
var SIGNATUREAPI_CLIENT_LINE = { page: 1, top: 172, left: 210 };

function requireTestKey_(apiKey) {
  if (!apiKey) throw new Error('Set the SIGNATUREAPI_KEY script property to a test key (key_test_...).');
  if (String(apiKey).indexOf('key_test_') !== 0) {
    throw new Error('This example runs in test mode only. Use a key that starts with key_test_.');
  }
}

// One sheet row -> one CreateEnvelope request body.
function buildEnvelopePayload_(rec) {
  return {
    title: 'Service Agreement - ' + rec.name,
    message: 'Please review and sign the service agreement.',
    metadata: { source: 'google_sheets', sheet_row: String(rec.rowNumber) },
    topics: ['no_code', 'sheets'],
    documents: [
      {
        key: 'service_agreement',
        url: SIGNATUREAPI_DOC_URL,
        format: 'pdf',
        fixed_positions: [
          { place_key: 'signer_signature', page: SIGNATUREAPI_CLIENT_LINE.page, top: SIGNATUREAPI_CLIENT_LINE.top, left: SIGNATUREAPI_CLIENT_LINE.left },
        ],
        places: [{ key: 'signer_signature', type: 'signature', recipient_key: 'signer' }],
      },
    ],
    recipients: [{ type: 'signer', key: 'signer', name: rec.name, email: rec.email }],
  };
}

// values = sheet.getDataRange().getValues(). Header row: name, email, role, envelope_id, status.
// Returns the rows that still need an envelope (empty envelope_id, name and email present).
function pendingRows_(values) {
  var header = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var col = {};
  ['name', 'email', 'role', 'envelope_id', 'status'].forEach(function (n) {
    col[n] = header.indexOf(n);
    if (col[n] < 0) throw new Error('Missing column: ' + n);
  });
  var out = [];
  for (var i = 1; i < values.length; i += 1) {
    var row = values[i];
    if (String(row[col.envelope_id]).trim() === '' && String(row[col.email]).trim() !== '' && String(row[col.name]).trim() !== '') {
      out.push({ rowNumber: i + 1, name: String(row[col.name]).trim(), email: String(row[col.email]).trim(), role: String(row[col.role]).trim(), col: col });
    }
  }
  return out;
}

// http(url, { method, headers, contentType, body }) -> { status, body }  (synchronous)
function apiCall_(apiKey, baseUrl, http, method, path, json) {
  var opts = { method: method, headers: { 'X-API-Key': apiKey } };
  if (json !== undefined) {
    opts.contentType = 'application/json';
    opts.body = JSON.stringify(json);
  }
  var res = http((baseUrl || SIGNATUREAPI_BASE_URL) + path, opts);
  var data = null;
  try { data = res.body ? JSON.parse(res.body) : null; } catch (e) { data = { raw: res.body }; }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(method + ' ' + path + ' failed with ' + res.status + ': ' + ((data && (data.detail || data.title)) || res.body));
  }
  return data;
}

function createEnvelope_(apiKey, payload, http, baseUrl) {
  requireTestKey_(apiKey);
  return apiCall_(apiKey, baseUrl, http, 'POST', '/v1/envelopes', payload);
}

function getEnvelope_(apiKey, id, http, baseUrl) {
  requireTestKey_(apiKey);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error('Not an envelope id');
  return apiCall_(apiKey, baseUrl, http, 'GET', '/v1/envelopes/' + id);
}

var SIGNATUREAPI_FINAL_STATUSES = ['completed', 'canceled', 'failed'];

// values = sheet.getDataRange().getValues(). Returns the rows whose envelope can still change:
// an envelope_id is set and the status is not completed, canceled or failed.
function rowsToRefresh_(values) {
  var header = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var idCol = header.indexOf('envelope_id');
  var statusCol = header.indexOf('status');
  if (idCol < 0 || statusCol < 0) throw new Error('Missing column: envelope_id or status');
  var out = [];
  for (var i = 1; i < values.length; i += 1) {
    var id = String(values[i][idCol]).trim();
    var status = String(values[i][statusCol]).trim();
    if (id !== '' && SIGNATUREAPI_FINAL_STATUSES.indexOf(status) < 0) {
      out.push({ rowNumber: i + 1, id: id, statusCol: statusCol });
    }
  }
  return out;
}

if (typeof module !== 'undefined') {
  module.exports = { buildEnvelopePayload_: buildEnvelopePayload_, pendingRows_: pendingRows_, createEnvelope_: createEnvelope_, getEnvelope_: getEnvelope_, rowsToRefresh_: rowsToRefresh_, requireTestKey_: requireTestKey_ };
}
