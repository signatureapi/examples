import { createApp } from "./app.mjs";

if (!process.env.SIGNATUREAPI_WEBHOOK_SECRET) {
  console.error("Set SIGNATUREAPI_WEBHOOK_SECRET to the signing secret of your webhook endpoint.");
  process.exit(1);
}
const port = Number(process.env.PORT ?? 3000);
createApp().listen(port, () => console.log(`Listening on http://localhost:${port}/webhooks/signatureapi`));
