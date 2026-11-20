// Download the signed PDF (deliverable) of a completed envelope.
// Usage: node download-deliverable.mjs <envelope-id> [output.pdf]
import { writeFile } from 'node:fs/promises';
import { api, fail, getConfig, isMain } from './lib.mjs';
import { getEnvelope } from './get-status.mjs';

export async function downloadDeliverable(config, envelopeId, outputPath) {
  const envelope = await getEnvelope(config, envelopeId);
  if (envelope.status !== 'completed') {
    throw new Error(`Envelope is ${envelope.status}. The deliverable exists once the envelope is completed.`);
  }
  if (!envelope.deliverable) throw new Error('The envelope has no deliverable yet. Try again in a few seconds.');
  const deliverable = await api(config, 'GET', `/v1/deliverables/${encodeURIComponent(envelope.deliverable.id)}`);
  if (deliverable.status !== 'generated') {
    throw new Error(`Deliverable is ${deliverable.status}. Try again once it is generated.`);
  }
  // deliverable.url is a pre-signed link that expires after 1 hour. It needs no API key.
  const response = await fetch(deliverable.url);
  if (!response.ok) throw new Error(`Download failed with ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, bytes);
  return { deliverableId: deliverable.id, bytes: bytes.length };
}

if (isMain(import.meta.url)) {
  const [envelopeId, output = 'signed-envelope.pdf'] = process.argv.slice(2);
  if (!envelopeId) fail(new Error('Usage: node download-deliverable.mjs <envelope-id> [output.pdf]'));
  try {
    const result = await downloadDeliverable(getConfig(), envelopeId, output);
    console.log(`Saved deliverable ${result.deliverableId} to ${output} (${result.bytes} bytes)`);
  } catch (error) {
    fail(error);
  }
}
