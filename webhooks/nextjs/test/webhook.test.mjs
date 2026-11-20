import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createHandler } from "../lib/webhook-handler.mjs";

const vector = JSON.parse(readFileSync(new URL("../../../verify-webhooks/test-vector.json", import.meta.url), "utf8"));
const byName = Object.fromEntries(vector.cases.map((c) => [c.name, c]));
const POST = createHandler({ secret: vector.secret, now: () => vector.now });

// The route handler is a plain Web (Request) => Response function, so we call it directly.
const post = (c) =>
  POST(new Request("http://localhost/api/webhooks/signatureapi", { method: "POST", headers: c.headers, body: c.body }));

test("valid delivery returns 2xx", async () => {
  assert.equal((await post(byName.valid)).status, 200);
});

test("a repeated webhook-id is acknowledged as a duplicate", async () => {
  const res = await post(byName.valid);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "duplicate" });
});

test("tampered body returns 4xx", async () => {
  assert.equal((await post(byName.tampered_body)).status, 400);
});

test("wrong secret returns 4xx", async () => {
  assert.equal((await post(byName.wrong_secret_signature)).status, 400);
});

test("missing headers return 4xx", async () => {
  assert.equal((await post(byName.missing_headers)).status, 400);
});
