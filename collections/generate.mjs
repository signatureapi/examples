#!/usr/bin/env node
// Generates Postman, Bruno, Insomnia and HTTPie collections from the public SignatureAPI
// OpenAPI bundle, keeping only the operations the docs document.
//
// Usage: node generate.mjs --bundle <public.bundle.json> [--documented documented-operations.json] [--out .]
// Zero dependencies. Output is deterministic, so a CI diff shows real spec changes only.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// Dataset values (synthetic). Path parameters use these so every request is ready to edit.
export const SAMPLE_IDS = {
  envelopeId: 'eb4cf433-a8af-4161-b37b-7ef57d423e56',
  recipientId: '{{recipient_id}}',
  deliverableId: '{{deliverable_id}}',
  uploadId: '{{upload_id}}',
  senderId: '{{sender_id}}',
};

// One request body per operation that takes JSON. Each body is validated against the spec in the tests.
export const SAMPLE_BODIES = {
  CreateEnvelope: {
    title: 'Service Agreement',
    message: 'Hi, please review and sign the Acme Corp Service Agreement.',
    metadata: { customer_ref: 'ACME-1001' },
    documents: [
      {
        url: 'https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf',
        format: 'pdf',
        places: [{ key: 'client_signature', type: 'signature', recipient_key: 'client' }],
        fixed_positions: [{ place_key: 'client_signature', page: 1, top: 172, left: 210 }],
      },
    ],
    recipients: [{ key: 'client', type: 'signer', name: 'Jane Doe', email: 'jane.doe@example.com' }],
  },
  UpdateEnvelope: { label: 'Acme Corp renewal 2026' },
  CancelEnvelope: { reason: 'Superseded by a new version of the agreement' },
  CreateDeliverable: { type: 'standard' },
  ReplaceRecipient: { name: 'John Smith', email: 'john.smith@example.com' },
  ResendRequest: { subject_override: 'Reminder: please sign the Service Agreement' },
  CreateRecipientCeremony: { authentication: [{ type: 'email_code' }] },
  StoreUpload: { key: 'service-agreement-v1' },
  CreateSender: { email: 'legal@acme.example' },
};

function parseArgs(argv) {
  const args = { documented: join(HERE, 'documented-operations.json'), out: HERE };
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!args.bundle) throw new Error('Usage: node generate.mjs --bundle <public.bundle.json> [--documented file] [--out dir]');
  return args;
}

function resolveRef(bundle, node) {
  let current = node;
  while (current && current.$ref) {
    current = current.$ref.split('/').slice(1).reduce((acc, key) => acc[key], bundle);
  }
  return current;
}

/** Turns the bundle into a flat, ordered list of documented operations. */
export function collectOperations(bundle, documentedIds) {
  const basePath = new URL(bundle.servers[0].url).pathname.replace(/\/$/, ''); // "/v1"
  const ops = [];
  for (const [path, item] of Object.entries(bundle.paths)) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op || !documentedIds.has(op.operationId)) continue;
      const params = [...(item.parameters || []), ...(op.parameters || [])].map((p) => resolveRef(bundle, p));
      const content = op.requestBody?.content || {};
      const contentType = Object.keys(content)[0] || null;
      ops.push({
        id: op.operationId,
        name: op.summary || op.operationId,
        description: clean(op.description || ''),
        folder: (op.tags && op.tags[0]) || 'Other',
        method: method.toUpperCase(),
        path: basePath + path,
        query: params.filter((p) => p.in === 'query').map((p) => ({ name: p.name, description: p.description || '' })),
        pathParams: params.filter((p) => p.in === 'path').map((p) => p.name),
        contentType,
        body: contentType === 'application/json' ? SAMPLE_BODIES[op.operationId] ?? {} : null,
      });
    }
  }
  const order = ['Envelopes', 'Recipients', 'Deliverables', 'Events', 'Uploads', 'Senders'];
  const rank = (folder) => (order.includes(folder) ? order.indexOf(folder) : order.length);
  return ops.sort((a, b) => rank(a.folder) - rank(b.folder) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/** House style: no em dashes in generated files. */
function clean(text) {
  return text.trim().replace(/\s*\u2014\s*/g, ', ');
}

function sampleFor(param) {
  return SAMPLE_IDS[param] ?? `{{${param}}}`;
}

/** "/v1/envelopes/{envelopeId}" with a templating style: postman/bruno "{{x}}", insomnia "{{ _.x }}". */
function fillPath(path, style) {
  return path.replace(/\{(\w+)\}/g, (_, name) => {
    const value = sampleFor(name);
    if (!value.startsWith('{{')) return value;
    const variable = value.slice(2, -2);
    return style === 'insomnia' ? `{{ _.${variable} }}` : `{{${variable}}}`;
  });
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function postmanCollection(ops) {
  const folders = [...new Set(ops.map((o) => o.folder))];
  return {
    info: {
      name: 'SignatureAPI',
      description: 'SignatureAPI public API, generated from the OpenAPI spec. Docs: https://signatureapi.com/docs/api',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: { type: 'apikey', apikey: [{ key: 'key', value: 'X-API-Key', type: 'string' }, { key: 'value', value: '{{api_key}}', type: 'string' }, { key: 'in', value: 'header', type: 'string' }] },
    variable: [{ key: 'base_url', value: 'https://api.signatureapi.com' }],
    item: folders.map((folder) => ({
      name: folder,
      item: ops.filter((o) => o.folder === folder).map((o) => {
        const raw = `{{base_url}}${fillPath(o.path, 'postman')}`;
        const request = {
          method: o.method,
          header: o.contentType ? [{ key: 'Content-Type', value: o.contentType }] : [],
          url: {
            raw,
            host: ['{{base_url}}'],
            path: fillPath(o.path, 'postman').split('/').filter(Boolean),
            ...(o.query.length ? { query: o.query.map((q) => ({ key: q.name, value: '', description: q.description, disabled: true })) } : {}),
          },
          description: o.description,
        };
        if (o.body) request.body = { mode: 'raw', raw: JSON.stringify(o.body, null, 2), options: { raw: { language: 'json' } } };
        else if (o.contentType) request.body = { mode: 'file', file: {} };
        return { name: o.name, request };
      }),
    })),
  };
}

export function postmanEnvironment() {
  return {
    name: 'SignatureAPI test mode',
    values: [
      { key: 'base_url', value: 'https://api.signatureapi.com', type: 'default', enabled: true },
      { key: 'api_key', value: 'key_test_YOUR_KEY', type: 'secret', enabled: true },
      { key: 'recipient_id', value: '', type: 'default', enabled: true },
      { key: 'deliverable_id', value: '', type: 'default', enabled: true },
      { key: 'upload_id', value: '', type: 'default', enabled: true },
      { key: 'sender_id', value: '', type: 'default', enabled: true },
    ],
  };
}

export function brunoFiles(ops) {
  const files = {
    'bruno.json': json({ version: '1', name: 'SignatureAPI', type: 'collection', ignore: ['node_modules', '.git'] }),
    'collection.bru': 'auth {\n  mode: apikey\n}\n\nauth:apikey {\n  key: X-API-Key\n  value: {{api_key}}\n  placement: header\n}\n',
    'environments/test-mode.bru':
      'vars {\n  base_url: https://api.signatureapi.com\n  recipient_id: \n  deliverable_id: \n  upload_id: \n  sender_id: \n}\nvars:secret [\n  api_key\n]\n',
  };
  const seqByFolder = {};
  for (const o of ops) {
    seqByFolder[o.folder] = (seqByFolder[o.folder] || 0) + 1;
    const method = o.method.toLowerCase();
    const bodyMode = o.body ? 'json' : o.contentType ? 'file' : 'none';
    let text = `meta {\n  name: ${o.name}\n  type: http\n  seq: ${seqByFolder[o.folder]}\n}\n\n`;
    text += `${method} {\n  url: {{base_url}}${fillPath(o.path, 'bruno')}\n  body: ${bodyMode}\n  auth: inherit\n}\n`;
    if (o.query.length) text += `\nparams:query {\n${o.query.map((q) => `  ~${q.name}: `).join('\n')}\n}\n`;
    if (o.body) text += `\nbody:json {\n${JSON.stringify(o.body, null, 2).split('\n').map((l) => `  ${l}`).join('\n')}\n}\n`;
    if (o.contentType && !o.body) text += `\nheaders {\n  Content-Type: ${o.contentType}\n}\n`;
    if (o.description) text += `\ndocs {\n${o.description.split('\n').map((l) => `  ${l}`).join('\n')}\n}\n`;
    files[`${o.folder}/${slug(o.name)}.bru`] = text;
  }
  return files;
}

export function insomniaExport(ops) {
  const resources = [
    { _id: 'wrk_signatureapi', _type: 'workspace', name: 'SignatureAPI', description: 'Generated from the SignatureAPI OpenAPI spec.' },
    { _id: 'environment_base', _type: 'environment', parentId: 'wrk_signatureapi', name: 'Base Environment', data: {} },
    {
      _id: 'environment_test_mode', _type: 'environment', parentId: 'environment_base', name: 'SignatureAPI test mode',
      data: { base_url: 'https://api.signatureapi.com', api_key: 'key_test_YOUR_KEY', recipient_id: '', deliverable_id: '', upload_id: '', sender_id: '' },
    },
  ];
  for (const folder of [...new Set(ops.map((o) => o.folder))]) {
    resources.push({ _id: `fld_${slug(folder)}`, _type: 'request_group', parentId: 'wrk_signatureapi', name: folder });
  }
  for (const o of ops) {
    const headers = [{ name: 'X-API-Key', value: '{{ _.api_key }}' }];
    if (o.contentType) headers.push({ name: 'Content-Type', value: o.contentType });
    resources.push({
      _id: `req_${slug(o.id)}`, _type: 'request', parentId: `fld_${slug(o.folder)}`, name: o.name, description: o.description,
      method: o.method, url: `{{ _.base_url }}${fillPath(o.path, 'insomnia')}`, headers,
      parameters: o.query.map((q) => ({ name: q.name, value: '', disabled: true, description: q.description })),
      body: o.body ? { mimeType: 'application/json', text: JSON.stringify(o.body, null, 2) } : o.contentType ? { mimeType: o.contentType, fileName: '' } : {},
    });
  }
  return { _type: 'export', __export_format: 4, __export_source: 'signatureapi-examples', resources };
}

const shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

export function httpieScript(ops) {
  let out = '#!/usr/bin/env bash\n# SignatureAPI requests for the HTTPie CLI (https://httpie.io/cli), generated from the OpenAPI spec.\n';
  out += '# Set SIGNATUREAPI_KEY to a test key first. Copy one command at a time; this file is a reference, not a script to run.\n';
  out += 'BASE="${SIGNATUREAPI_BASE_URL:-https://api.signatureapi.com}"\n';
  for (const o of ops) {
    const path = o.path.replace(/\{(\w+)\}/g, (_, name) => {
      const v = sampleFor(name);
      return v.startsWith('{{') ? `$${v.slice(2, -2).toUpperCase()}` : v;
    });
    out += `\n# ${o.name} (${o.method} ${o.path})\n`;
    if (o.body) out += `# printf '%s' ${shellQuote(JSON.stringify(o.body))} | http ${o.method} "$BASE${path}" X-API-Key:"$SIGNATUREAPI_KEY"\n`;
    else if (o.contentType) out += `# http ${o.method} "$BASE${path}" X-API-Key:"$SIGNATUREAPI_KEY" Content-Type:${o.contentType} @file\n`;
    else out += `# http ${o.method} "$BASE${path}" X-API-Key:"$SIGNATUREAPI_KEY"\n`;
  }
  return out;
}

export function documentedSet(documented) {
  // Accepts { operations: [...] } (this repo, or the website's documented-today.json).
  return new Set(documented.operations);
}

export async function generate({ bundle, documented, out }) {
  const ops = collectOperations(bundle, documentedSet(documented));
  const files = {
    'postman/signatureapi.postman_collection.json': json(postmanCollection(ops)),
    'postman/test-mode.postman_environment.json': json(postmanEnvironment()),
    'insomnia/signatureapi.insomnia.json': json(insomniaExport(ops)),
    'httpie/signatureapi-httpie.sh': httpieScript(ops),
  };
  for (const [name, text] of Object.entries(brunoFiles(ops))) files[`bruno/${name}`] = text;
  for (const [name, text] of Object.entries(files)) {
    const target = join(out, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
  }
  return { operations: ops.length, files: Object.keys(files).length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  const bundle = JSON.parse(await readFile(args.bundle, 'utf8'));
  const documented = JSON.parse(await readFile(args.documented, 'utf8'));
  const result = await generate({ bundle, documented, out: args.out });
  console.log(`Generated ${result.files} files for ${result.operations} documented operations.`);
}
