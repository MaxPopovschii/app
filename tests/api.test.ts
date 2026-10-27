import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp, hashToken } from "../api/src/app";
import { memoryStore, report } from "./helpers";
const key = "test-only-agency-key-32-characters-minimum";
const payload = {
  url: "https://fixture.example",
  client: "Aurora",
  agency: "Forma",
  authorized: true,
  maxPages: 2,
};
test("report management is private; share links are read-only, opaque and revocable", async () => {
  const store = memoryStore(),
    jobs: string[] = [];
  const app = createApp({
    store,
    adminToken: key,
    artifactDir: "/tmp/launchcheck-tests",
    enqueue: async (id) => {
      jobs.push(id);
    },
  });
  await request(app).get("/api/reports").expect(401);
  await request(app).post("/crawl").send(payload).expect(404);
  await request(app)
    .post("/api/reports")
    .set("Authorization", "Bearer " + key)
    .send({ ...payload, url: "http://127.0.0.1" })
    .expect(400);
  await request(app)
    .post("/api/reports")
    .set("Authorization", "Bearer " + key)
    .send({ ...payload, authorized: false })
    .expect(400);
  const created = await request(app)
    .post("/api/reports")
    .set("Authorization", "Bearer " + key)
    .send(payload)
    .expect(202);
  assert.equal(jobs.length, 1);
  const token = created.body.sharePath.split("/").pop();
  await request(app)
    .get("/api/reports")
    .set("Authorization", "Bearer " + token)
    .expect(401);
  await request(app)
    .get("/api/share/" + token + "/assets/%2e%2e%2f.env")
    .expect(404);
  const stored = await store.get(created.body.id);
  assert.equal(stored?.shareHash, hashToken(token));
  assert.ok(!JSON.stringify(stored).includes(token));
  const shared = await request(app)
    .get("/api/share/" + token)
    .expect(200);
  assert.ok(!("shareHash" in shared.body));
  await request(app)
    .get("/api/share/" + token + "/assets/0-desktop.png")
    .expect(404);
  await request(app)
    .patch("/api/reports/" + created.body.id + "/findings/a")
    .send({ status: "resolved" })
    .expect(401);
  const rotated = await request(app)
    .post("/api/reports/" + created.body.id + "/share")
    .set("Authorization", "Bearer " + key)
    .expect(200);
  await request(app)
    .get("/api/share/" + token)
    .expect(404);
  const replacement = rotated.body.sharePath.split("/").pop();
  await request(app)
    .get("/api/share/" + replacement)
    .expect(200);
  await request(app)
    .delete("/api/reports/" + created.body.id + "/share")
    .set("Authorization", "Bearer " + key)
    .expect(204);
  await request(app)
    .get("/api/share/" + replacement)
    .expect(404);
});
test("baseline origin and completed-state constraints are enforced; queue failure is durable", async () => {
  const store = memoryStore();
  const baseline = report("https://other.example");
  baseline.status = "complete";
  await store.create({
    id: baseline.id,
    shareHash: "baseline",
    report: baseline,
  });
  const app = createApp({
    store,
    adminToken: key,
    artifactDir: "/tmp/launchcheck-tests",
    enqueue: async () => {
      throw new Error("queue unavailable");
    },
  });
  await request(app)
    .post("/api/reports")
    .set("Authorization", "Bearer " + key)
    .send({ ...payload, baselineId: baseline.id })
    .expect(400);
  await request(app)
    .post("/api/reports")
    .set("Authorization", "Bearer " + key)
    .send(payload)
    .expect(503);
  assert.equal((await store.list())[0].status, "failed");
});
