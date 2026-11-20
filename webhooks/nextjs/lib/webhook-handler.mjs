import { WebhookVerificationError, verifyWebhook } from "./webhook-verify.mjs";

// Production: replace with a shared store (see README). A module-level Set only dedupes within one server instance.
const seen = new Set();

export function createHandler({ secret, now = () => Math.floor(Date.now() / 1000) } = {}) {
  return async function POST(request) {
    // request.text() returns the body exactly as received. request.json() would parse it first,
    // and re-serializing the result does not give the bytes that were signed.
    const rawBody = await request.text();
    const headers = Object.fromEntries(request.headers);

    try {
      verifyWebhook(secret ?? process.env.SIGNATUREAPI_WEBHOOK_SECRET, headers, rawBody, { now: now() });
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const id = headers["webhook-id"];
    if (seen.has(id)) return Response.json({ status: "duplicate" });
    seen.add(id);

    const event = JSON.parse(rawBody);
    switch (event.type) {
      case "envelope.completed":
        console.log(`envelope ${event.data.envelope_id} completed`);
        break;
      case "recipient.completed":
        console.log(`recipient ${event.data.object_id} completed`);
        break;
      case "deliverable.generated":
        console.log(`deliverable ${event.data.object_id} is ready`);
        break;
      default:
        break;
    }

    // Respond fast. Hand slow work to a queue.
    return Response.json({ status: "ok" });
  };
}
