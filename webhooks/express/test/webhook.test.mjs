import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createApp } from "../app.mjs";

const vector = JSON.parse(readFileSync(new URL("../../../verify-webhooks/test-vector.json", import.meta.url), "utf8"));
const byName = Object.fromEntries(vector.cases.map((c) => [c.name, c]));

let server;
let base;

before(async () => {
  const app = createApp({ secret: vector.secret, now: () => vector.now });
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/webhooks/signatureapi`;
});
after(() => server.close());

const post = (c) =>
  fetch(base, { method: "POST", headers: { "content-type": "application/json", ...c.headers }, body: c.body });

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
