// Send the sample Service Agreement to one signer.
// Usage: node send-envelope.mjs [name] [email]
import { api, buildServiceAgreement, fail, getConfig, isMain } from './lib.mjs';

export async function sendEnvelope(config, signer) {
  return api(config, 'POST', '/v1/envelopes', { json: buildServiceAgreement(signer) });
}

if (isMain(import.meta.url)) {
  const [name = 'Jane Doe', email = 'jane.doe@example.com'] = process.argv.slice(2);
  try {
    const envelope = await sendEnvelope(getConfig(), { name, email });
    console.log(`Envelope created: ${envelope.id}`);
    console.log(`Status: ${envelope.status}`);
    for (const recipient of envelope.recipients) {
      console.log(`Recipient ${recipient.key}: ${recipient.name} <${recipient.email}> (${recipient.status})`);
    }
  } catch (error) {
    fail(error);
  }
}
