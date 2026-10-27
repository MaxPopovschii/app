import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createFetchApp } from "../fetcher/src/app";
import {
  createFetcherClient,
  hashPassword,
  verifyPassword,
  publicOrigin,
} from "@launchcheck/shared";
const token = "test-fetcher-service-token-with-32-characters";
test("fetch gateway authenticates, clamps budgets and rejects mutation methods", async () => {
  let called: any;
  const app = createFetchApp(token, async (url, options) => {
    called = { url, options };
    return {
      url,
      status: 200,
      headers: { "content-type": "text/plain" },
      body: Buffer.from("fixture"),
    };
  });
  await request(app)
    .post("/fetch")
    .send({ url: "https://fixture.example" })
    .expect(401);
  for (const options of [{ method: "POST" }, null, []])
    await request(app)
      .post("/fetch")
      .set("Authorization", "Bearer " + token)
      .send({ url: "https://fixture.example", options })
      .expect(400);
  const response = await request(app)
    .post("/fetch")
    .set("Authorization", "Bearer " + token)
    .send({
      url: "https://fixture.example",
      options: { maxBytes: 90000000, timeoutMs: 900000 },
    })
    .expect(200);
  assert.equal(called.options.maxBytes, 5000000);
  assert.equal(called.options.timeoutMs, 10000);
  assert.equal(Buffer.from(response.body.body, "base64").toString(), "fixture");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  try {
    const client = createFetcherClient(
      "http://127.0.0.1:" + (server.address() as any).port,
      token,
    );
    assert.equal(
      (await client("https://fixture.example")).body.toString(),
      "fixture",
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("password hashing is salted and rejects malformed encodings", async () => {
  const password = "A sufficiently long passphrase";
  const a = await hashPassword(password),
    b = await hashPassword(password);
  assert.notEqual(a, b);
  assert.ok(await verifyPassword(password, a));
  assert.equal(await verifyPassword("wrong", a), false);
  assert.equal(await verifyPassword(password, "scrypt$bad"), false);
  await assert.rejects(() => hashPassword("short"));
});
