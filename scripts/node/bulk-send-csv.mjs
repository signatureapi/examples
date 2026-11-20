// Send one envelope per row of a CSV file (columns: name,email,customer_ref).
// Usage: node bulk-send-csv.mjs signers.csv
import { readFile } from 'node:fs/promises';
import { api, buildServiceAgreement, fail, getConfig, isMain } from './lib.mjs';

/** Minimal CSV parser: header row, comma separated, double quotes for values with commas. */
export function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        cells.push(cell);
        cell = '';
      } else cell += ch;
    }
    cells.push(cell);
    rows.push(cells.map((c) => c.trim()));
  }
  const [header, ...data] = rows;
  return data.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])));
}

/** Sends envelopes one at a time and keeps going when a row fails. */
export async function bulkSend(config, rows, { delayMs = 250 } = {}) {
  const results = [];
  for (const [index, row] of rows.entries()) {
    const payload = buildServiceAgreement({
      name: row.name,
      email: row.email,
      metadata: { customer_ref: row.customer_ref, batch_row: String(index + 1) },
    });
    try {
      const envelope = await api(config, 'POST', '/v1/envelopes', { json: payload });
      results.push({ row: index + 1, email: row.email, ok: true, envelopeId: envelope.id });
    } catch (error) {
      results.push({ row: index + 1, email: row.email, ok: false, error: error.message });
    }
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return results;
}

if (isMain(import.meta.url)) {
  const file = process.argv[2] || 'signers.csv';
  try {
    const rows = parseCsv(await readFile(file, 'utf8'));
    const results = await bulkSend(getConfig(), rows);
    for (const r of results) {
      console.log(r.ok ? `row ${r.row} ${r.email}: sent ${r.envelopeId}` : `row ${r.row} ${r.email}: FAILED ${r.error}`);
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(`${results.length - failed} sent, ${failed} failed`);
    if (failed) process.exit(1);
  } catch (error) {
    fail(error);
  }
}
