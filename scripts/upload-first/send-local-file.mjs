// Send a PDF or DOCX from your own disk for signature: upload it first, then create the envelope.
// Usage: node send-local-file.mjs [path/to/file.pdf] [name] [email]
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTENT_TYPES = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const MAX_BYTES = 4.5 * 1024 * 1024; // Create Upload limit

export function getConfig(env = process.env) {
  const apiKey = env.SIGNATUREAPI_KEY;
  if (!apiKey || !apiKey.startsWith('key_test_')) {
    throw new Error('Set SIGNATUREAPI_KEY to a test API key (it starts with key_test_).');
  }
  return { apiKey, baseUrl: (env.SIGNATUREAPI_BASE_URL || 'https://api.signatureapi.com').replace(/\/+$/, '') };
}

async function call(config, method, path, init) {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    ...init,
    headers: { 'X-API-Key': config.apiKey, Accept: 'application/json', ...init.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`SignatureAPI returned ${response.status}: ${body?.detail || body?.title || 'error'}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

/** Step 1: send the raw bytes to POST /v1/uploads. The response url is valid for 24 hours. */
export async function uploadFile(config, path) {
  const contentType = CONTENT_TYPES[extname(path).toLowerCase()];
  if (!contentType) throw new Error('Only .pdf and .docx files can be uploaded as documents.');
  const bytes = await readFile(path);
  if (bytes.length > MAX_BYTES) throw new Error('The file is larger than 4.5 MB. Host it on an external store instead.');
  const upload = await call(config, 'POST', '/v1/uploads', { body: bytes, headers: { 'Content-Type': contentType } });
  return { url: upload.url, format: contentType === 'application/pdf' ? 'pdf' : 'docx', id: upload.id };
}

/** Step 2: use the upload url as the document url. */
export function buildEnvelope({ upload, title, name, email }) {
  return {
    title,
    documents: [
      {
        url: upload.url,
        format: upload.format,
        places: [{ key: 'client_signature', type: 'signature', recipient_key: 'client' }],
        // Coordinates fit the bundled sample. For your own file, use [[placeholders]] or your own coordinates.
        fixed_positions: [{ place_key: 'client_signature', page: 1, top: 172, left: 210 }],
      },
    ],
    recipients: [{ key: 'client', type: 'signer', name, email }],
  };
}

export async function sendLocalFile(config, { path, name, email }) {
  const upload = await uploadFile(config, path);
  const title = basename(path, extname(path)).replace(/[-_]+/g, ' ');
  return call(config, 'POST', '/v1/envelopes', {
    body: JSON.stringify(buildEnvelope({ upload, title, name, email })),
    headers: { 'Content-Type': 'application/json' },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [path = 'service-agreement.pdf', name = 'Jane Doe', email = 'jane.doe@example.com'] = process.argv.slice(2);
  try {
    const envelope = await sendLocalFile(getConfig(), { path, name, email });
    console.log(`Uploaded ${path} and created envelope ${envelope.id} (${envelope.status})`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}
