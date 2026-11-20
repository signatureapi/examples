// Thin Google Apps Script shim around Core.gs. Everything here talks to Google services,
// so it only runs inside Apps Script (the test suite exercises it with fakes).

function onOpen() {
  SpreadsheetApp.getUi().createMenu('SignatureAPI').addItem('Send envelopes for new rows', 'sendEnvelopesFromSheet').addToUi();
}

function apiKey_() {
  return PropertiesService.getScriptProperties().getProperty('SIGNATUREAPI_KEY');
}

function httpFetch_(url, opts) {
  var params = { method: opts.method, headers: opts.headers, muteHttpExceptions: true };
  if (opts.body !== undefined) {
    params.payload = opts.body;
    params.contentType = opts.contentType;
  }
  var res = UrlFetchApp.fetch(url, params);
  return { status: res.getResponseCode(), body: res.getContentText() };
}

// Sends one envelope for every row that has no envelope_id yet, then writes the id and status back.
function sendEnvelopesFromSheet() {
  var key = apiKey_();
  var sheet = SpreadsheetApp.getActiveSheet();
  var rows = pendingRows_(sheet.getDataRange().getValues());
  rows.forEach(function (rec) {
    try {
      var envelope = createEnvelope_(key, buildEnvelopePayload_(rec), httpFetch_);
      sheet.getRange(rec.rowNumber, rec.col.envelope_id + 1, 1, 2).setValues([[envelope.id, envelope.status]]);
    } catch (e) {
      sheet.getRange(rec.rowNumber, rec.col.status + 1).setValue('error: ' + e.message);
    }
    Utilities.sleep(200); // stay inside the rate limit
  });
}

// Reads every unfinished envelope on the first sheet and writes its current status into the row.
// A time-driven trigger runs it (see installRefreshTrigger), so it does not rely on an active sheet.
function refreshStatuses() {
  var key = apiKey_();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  rowsToRefresh_(sheet.getDataRange().getValues()).forEach(function (row) {
    try {
      sheet.getRange(row.rowNumber, row.statusCol + 1).setValue(getEnvelope_(key, row.id, httpFetch_).status);
    } catch (e) {
      sheet.getRange(row.rowNumber, row.statusCol + 1).setValue('error: ' + e.message);
    }
    Utilities.sleep(200); // stay inside the rate limit
  });
}

// Run once from the editor: refreshes the statuses every hour.
function installRefreshTrigger() {
  ScriptApp.newTrigger('refreshStatuses').timeBased().everyHours(1).create();
}
