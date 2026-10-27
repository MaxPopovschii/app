import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp, hashToken } from "../api/src/app";
import {
  memoryStore,
  memoryIdentity,
  testPassword,
  report,
  stored,
} from "./helpers";
const origin = "http://localhost";
const payload = {
  url: "https://fixture.example/",
  client: "Aurora",
  authorized: true,
  maxPages: 2,
};
async function fixture(enqueue = async (_id: string) => {}) {
  const store = memoryStore(),
    identity = await memoryIdentity();
  const options = {
    store,
    identities: identity.identities,
    authSecret: "test-secret-with-at-least-32-characters",
    secureCookies: false,
    publicOrigin: origin,
    artifactDir: "/tmp/launchcheck-tests",
    enqueue,
  };
  const app = createApp(options);
  return { app, store, ...identity, options };
}
async function login(app: any, email = "owner@example.com") {
  const agent = request.agent(app);
  const r = await agent
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email, password: testPassword })
    .expect(200);
  assert.match(r.headers["set-cookie"][0], /HttpOnly/);
  assert.match(r.headers["set-cookie"][0], /SameSite=Strict/);
  return { agent, csrf: r.body.csrfToken };
}
test("sessions enforce CSRF, tenant isolation, viewer roles and revocable public links", async () => {
  const { app, store } = await fixture();
  await request(app).get("/api/reports").expect(401);
  await request(app)
    .get("/api/reports")
    .set("Authorization", "Bearer legacy-key")
    .expect(401);
  const { agent, csrf } = await login(app),
    other = await login(app, "other@example.com"),
    viewer = await login(app, "viewer@example.com");
  await agent.post("/api/reports").send(payload).expect(403);
  await agent
    .post("/api/reports")
    .set("Origin", "https://evil.example")
    .set("X-CSRF-Token", csrf)
    .send(payload)
    .expect(403);
  await viewer.agent
    .post("/api/reports")
    .set("Origin", origin)
    .set("X-CSRF-Token", viewer.csrf)
    .send(payload)
    .expect(403);
  await agent
    .post("/api/reports")
    .set("Origin", origin)
    .set("X-CSRF-Token", csrf)
    .send({ ...payload, url: "http://127.0.0.1" })
    .expect(400);
  const created = await agent
    .post("/api/reports")
    .set("Origin", origin)
    .set("X-CSRF-Token", csrf)
    .send({ ...payload, agency: "Forged tenant" })
    .expect(202);
  const id = created.body.id,
    token = created.body.sharePath.split("/").pop();
  assert.equal(store.values.get(id)!.shareHash, hashToken(token));
  assert.equal(store.values.get(id)!.report.agency, "Studio Forma");
  await other.agent.get("/api/reports/" + id).expect(404);
  assert.equal((await other.agent.get("/api/reports")).body.length, 0);
  await other.agent
    .post("/api/reports/" + id + "/share")
    .set("Origin", origin)
    .set("X-CSRF-Token", other.csrf)
    .expect(404);
  await request(app)
    .get("/api/share/" + token)
    .expect(200);
  await request(app)
    .get("/api/share/" + token + "/assets/%2e%2e%2f.env")
    .expect(404);
  const rotated = await agent
    .post("/api/reports/" + id + "/share")
    .set("Origin", origin)
    .set("X-CSRF-Token", csrf)
    .expect(200);
  await request(app)
    .get("/api/share/" + token)
    .expect(404);
  const next = rotated.body.sharePath.split("/").pop();
  await request(app)
    .get("/api/share/" + next)
    .expect(200);
  store.values.get(id)!.shareExpiresAt = new Date(0);
  await request(app)
    .get("/api/share/" + next)
    .expect(404);
  await agent
    .delete("/api/reports/" + id)
    .set("Origin", origin)
    .set("X-CSRF-Token", csrf)
    .expect(409);
  const doc = store.values.get(id)!;
  doc.report.status = "complete";
  await store.finish(id, doc.report);
  await agent
    .delete("/api/reports/" + id)
    .set("Origin", origin)
    .set("X-CSRF-Token", csrf)
    .expect(202);
  await agent.get("/api/reports/" + id).expect(404);
  await agent
    .post("/api/auth/logout")
    .set("Origin", origin)
    .set("X-CSRF-Token", csrf)
    .expect(204);
  await agent.get("/api/reports").expect(401);
});
test("session deadlines and password changes revoke all sessions", async () => {
  const f = await fixture();
  const first = await login(f.app),
    second = await login(f.app);
  for (const session of f.sessions.values())
    session.idleExpiresAt = new Date(0);
  await first.agent.get("/api/auth/session").expect(401);
  const fresh = await login(f.app);
  await fresh.agent
    .post("/api/auth/password")
    .set("Origin", origin)
    .set("X-CSRF-Token", fresh.csrf)
    .send({
      currentPassword: testPassword,
      newPassword: "Another long password 529!",
    })
    .expect(204);
  assert.equal(f.sessions.size, 0);
  await second.agent.get("/api/reports").expect(401);
  await request(f.app)
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email: "owner@example.com", password: testPassword })
    .expect(401);
});
test("readiness blocks new work; enqueue failure retains a recoverable reservation", async () => {
  const f = await fixture(async () => {
    throw new Error("offline");
  });
  const { agent, csrf } = await login(f.app);
  const baseline = report("https://other.example");
  baseline.status = "complete";
  await f.store.reserve(stored(baseline));
  await agent
    .post("/api/reports")
    .set("Origin", origin)
    .set("X-CSRF-Token", csrf)
    .send({ ...payload, baselineId: baseline.id })
    .expect(400);
  const result = await agent
    .post("/api/reports")
    .set("Origin", origin)
    .set("X-CSRF-Token", csrf)
    .send(payload)
    .expect(202);
  assert.equal(f.store.values.get(result.body.id)!.report.status, "queued");
  const app = createApp({
    ...f.options,
    readiness: async () => ({ ready: false, checks: { worker: false } }),
  });
  const logged = await login(app);
  await request(app).get("/readyz").expect(503);
  await logged.agent
    .post("/api/reports")
    .set("Origin", origin)
    .set("X-CSRF-Token", logged.csrf)
    .send(payload)
    .expect(503);
});
test("persistent login buckets limit guessing", async () => {
  const { app } = await fixture();
  for (let i = 0; i < 10; i++)
    await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: "missing@example.com", password: "wrong" })
      .expect(401);
  await request(app)
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email: "owner@example.com", password: testPassword })
    .expect(429);
});
