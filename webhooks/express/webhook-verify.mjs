import { createHmac, timingSafeEqual } from "node:crypto";

export class WebhookVerificationError extends Error {}

/**
 * Verify a Standard Webhooks signature.
 *
 * @param {string} secret   Signing secret, "whsec_<base64 key>".
 * @param {Record<string, string | undefined>} headers  Request headers. Names are matched case-insensitively.
 * @param {string | Buffer} rawBody  The exact bytes received. Never a re-serialized object.
 * @param {{ now?: number, toleranceSeconds?: number }} [options]  `now` is Unix seconds (defaults to the clock).
 * @returns {true} Throws WebhookVerificationError when the delivery is not authentic.
 */
export function verifyWebhook(secret, headers, rawBody, options = {}) {
  const { now = Math.floor(Date.now() / 1000), toleranceSeconds = 300 } = options;
  const lower = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const id = lower["webhook-id"];
  const timestamp = lower["webhook-timestamp"];
  const signatureHeader = lower["webhook-signature"];
  if (!id || !timestamp || !signatureHeader) {
    throw new WebhookVerificationError("Missing webhook-id, webhook-timestamp or webhook-signature header");
  }

  if (!/^\d+$/.test(timestamp)) {
    throw new WebhookVerificationError("Invalid webhook-timestamp");
  }
  if (Math.abs(now - Number(timestamp)) > toleranceSeconds) {
    throw new WebhookVerificationError("Timestamp outside the tolerance window");
  }

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  const expected = createHmac("sha256", key)
    .update(Buffer.concat([Buffer.from(`${id}.${timestamp}.`, "utf8"), body]))
    .digest();

  // The header holds space-separated "v1,<base64>" entries. Any match is enough.
  for (const entry of signatureHeader.split(" ")) {
    const [version, signature] = entry.split(",", 2);
    if (version !== "v1" || !signature) continue;
    const candidate = Buffer.from(signature, "base64");
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return true;
    }
  }
  throw new WebhookVerificationError("No matching signature");
}
