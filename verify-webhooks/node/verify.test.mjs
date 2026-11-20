import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { verifyWebhook } from "./verify.mjs";

const vector = JSON.parse(readFileSync(new URL("../test-vector.json", import.meta.url), "utf8"));

for (const c of vector.cases) {
  test(`test vector: ${c.name}`, () => {
    const run = () =>
      verifyWebhook(vector.secret, c.headers, c.body, {
        now: vector.now,
        toleranceSeconds: vector.tolerance_seconds,
      });
    if (c.expect === "valid") assert.equal(run(), true);
    else assert.throws(run, /./);
  });
}

test("header names are case-insensitive", () => {
  const c = vector.cases[0];
  const upper = Object.fromEntries(Object.entries(c.headers).map(([k, v]) => [k.toUpperCase(), v]));
  assert.equal(verifyWebhook(vector.secret, upper, c.body, { now: vector.now }), true);
});

test("accepts the body as a Buffer", () => {
  const c = vector.cases[0];
  assert.equal(verifyWebhook(vector.secret, c.headers, Buffer.from(c.body), { now: vector.now }), true);
});
