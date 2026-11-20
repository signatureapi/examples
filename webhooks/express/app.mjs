import express from "express";
import { WebhookVerificationError, verifyWebhook } from "./webhook-verify.mjs";

/**
 * Build the Express app. `now` is injectable so tests can pin the clock.
 * Production dedupe belongs in a shared store (see README); a Set is enough to show the shape.
 */
export function createApp({ secret = process.env.SIGNATUREAPI_WEBHOOK_SECRET, now = () => Math.floor(Date.now() / 1000) } = {}) {
  const app = express();
  const seen = new Set();

  // express.raw keeps the exact bytes. express.json() would parse and re-serialize them,
  // and the signature is computed over the original bytes.
  app.post("/webhooks/signatureapi", express.raw({ type: "*/*", limit: "1mb" }), (req, res) => {
    try {
      verifyWebhook(secret, req.headers, req.body, { now: now() });
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }

    const id = req.headers["webhook-id"];
    if (seen.has(id)) return res.status(200).json({ status: "duplicate" });
    seen.add(id);

    const event = JSON.parse(req.body.toString("utf8"));
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
        break; // Acknowledge event types you do not handle so they are not retried.
    }

    // Respond fast. Hand slow work (downloads, emails, database writes) to a queue.
    res.status(200).json({ status: "ok" });
  });

  return app;
}
