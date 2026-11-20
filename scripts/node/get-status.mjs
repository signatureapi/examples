// Print the status of an envelope and each of its recipients.
// Usage: node get-status.mjs <envelope-id>
import { api, fail, getConfig, isMain } from './lib.mjs';

export async function getEnvelope(config, envelopeId) {
  return api(config, 'GET', `/v1/envelopes/${encodeURIComponent(envelopeId)}`);
}

if (isMain(import.meta.url)) {
  const envelopeId = process.argv[2];
  if (!envelopeId) fail(new Error('Usage: node get-status.mjs <envelope-id>'));
  try {
    const envelope = await getEnvelope(getConfig(), envelopeId);
    console.log(`Envelope ${envelope.id}: ${envelope.status}`);
    for (const recipient of envelope.recipients) {
      console.log(`  ${recipient.key} (${recipient.type}): ${recipient.status}`);
    }
    if (envelope.deliverable) {
      console.log(`Deliverable ${envelope.deliverable.id}: ${envelope.deliverable.status}`);
    }
  } catch (error) {
    fail(error);
  }
}
