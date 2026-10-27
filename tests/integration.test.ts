import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import amqp from "amqplib";
import request from "supertest";
import { mongoStore, AuditModel } from "@launchcheck/shared";
import { createApp } from "../api/src/app";
import { runAudit } from "../worker/dist/audit";
import { fixtureClient } from "./helpers";
test(
  "MongoDB persists the submitted report and RabbitMQ delivers the audit for real browser processing",
  { skip: process.env.INTEGRATION_TESTS !== "1", timeout: 90_000 },
  async () => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), "launchcheck-integration-"),
    );
    const connection = await amqp.connect(process.env.RABBIT_URL!);
    const channel = await connection.createConfirmChannel();
    const queue = "launchcheck.test." + randomUUID(),
      key = "integration-test-only-access-32-characters";
    let id: string | undefined;
    try {
      await mongoose.connect(process.env.MONGO_URI!);
      await channel.assertQueue(queue, { autoDelete: true });
      const app = createApp({
        store: mongoStore,
        adminToken: key,
        artifactDir: dir,
        enqueue: async (reportId) => {
          channel.sendToQueue(
            queue,
            Buffer.from(JSON.stringify({ id: reportId })),
            { persistent: true },
          );
          await channel.waitForConfirms();
        },
      });
      const created = await request(app)
        .post("/api/reports")
        .set("Authorization", "Bearer " + key)
        .send({
          url: "https://fixture.example/",
          client: "Fixture",
          agency: "Integration",
          maxPages: 1,
          authorized: true,
        })
        .expect(202);
      id = created.body.id;
      assert.equal((await mongoStore.get(id!))?.report.status, "queued");
      const message = await channel.get(queue, { noAck: false });
      assert.ok(message);
      assert.equal(JSON.parse(message.content.toString()).id, id);
      const doc = (await mongoStore.get(id!))!;
      await runAudit(doc.report, {
        artifactDir: dir,
        client: fixtureClient(),
        onProgress: (report) => mongoStore.update(id!, { report }),
      });
      channel.ack(message);
      const restored = (await mongoStore.get(id!))!;
      assert.equal(restored.report.status, "complete");
      assert.equal(restored.report.pages.length, 2);
      const token = created.body.sharePath.split("/").pop();
      const shared = await request(app)
        .get("/api/share/" + token)
        .expect(200);
      assert.ok(shared.body.findings.length > 0);
      const asset = restored.report.pages[0].screenshot!;
      const image = await request(app)
        .get(`/api/share/${token}/assets/${asset}`)
        .expect(200);
      assert.match(image.headers["content-type"], /image\/png/);
    } finally {
      if (id) await AuditModel.deleteOne({ id });
      await channel.deleteQueue(queue);
      await channel.close();
      await connection.close();
      await mongoose.disconnect();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
