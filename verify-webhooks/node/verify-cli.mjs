// Usage: SIGNATUREAPI_WEBHOOK_SECRET=whsec_... node verify-cli.mjs
// Reads the vector's valid case by default, or a JSON file {headers, body}.
import { readFileSync } from "node:fs";
import { verifyWebhook } from "./verify.mjs";

const secret = process.env.SIGNATUREAPI_WEBHOOK_SECRET;
const vector = JSON.parse(readFileSync(new URL("../test-vector.json", import.meta.url), "utf8"));
const file = process.argv[2];
const delivery = file ? JSON.parse(readFileSync(file, "utf8")) : vector.cases[0];
const now = file ? undefined : vector.now;

try {
  verifyWebhook(secret ?? vector.secret, delivery.headers, delivery.body, { now });
  console.log("valid signature");
} catch (error) {
  console.error(`invalid: ${error.message}`);
  process.exit(1);
}
