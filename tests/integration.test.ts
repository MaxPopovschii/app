import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import amqp from "amqplib";
import {
  mongoStore,
  AuditModel,
  AgencyModel,
  CapacityModel,
  UsageModel,
  UserModel,
  SessionModel,
  provisionAccount,
  mongoIdentity,
  purgeReports,
  secret,
  createFetcherClient,
} from "@launchcheck/shared";
import { report, stored, testPassword } from "./helpers";
test(
  "replica-set transactions prevent overbooking and double release; retention retries safely",
  { skip: process.env.INTEGRATION_TESTS !== "1", timeout: 120000 },
  async () => {
    await mongoose.connect(secret("MONGO_URI"));
    const agencyId = randomUUID(),
      email = randomUUID() + "@example.com";
    const queue = "launchcheck.test." + randomUUID();
    let connection: any, channel: any;
    try {
      await Promise.all([
        AuditModel.init(),
        AgencyModel.init(),
        UsageModel.init(),
        CapacityModel.init(),
        UserModel.init(),
        SessionModel.init(),
      ]);
      await CapacityModel.updateOne(
        { id: "global" },
        { $setOnInsert: { active: 0, limit: 12 } },
        { upsert: true },
      );
      await AgencyModel.create({
        id: agencyId,
        name: "Transaction fixture",
        concurrencyLimit: 2,
        dailyLimit: 3,
      });
      const account = await provisionAccount({
        agencyId,
        agency: "Fixture",
        email,
        name: "Fixture",
        password: testPassword,
      });
      assert.equal(
        (await mongoIdentity.userByEmail(email))!.agencyId,
        agencyId,
      );
      const docs = Array.from({ length: 8 }, () => stored(report(), agencyId));
      const outcomes = await Promise.allSettled(
        docs.map((d) => mongoStore.reserve(d)),
      );
      assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 2);
      assert.equal((await AgencyModel.findOne({ id: agencyId })).active, 2);
      const admitted = await AuditModel.find({ agencyId }).lean();
      for (const d of admitted) {
        const r = d.report as any;
        r.status = "complete";
        await Promise.all([
          mongoStore.finish(String(d.id), r),
          mongoStore.finish(String(d.id), r),
        ]);
      }
      assert.equal((await AgencyModel.findOne({ id: agencyId })).active, 0);
      const extra = stored(report(), agencyId);
      await mongoStore.reserve(extra);
      extra.report.status = "complete";
      await mongoStore.finish(extra.id, extra.report);
      await assert.rejects(
        () => mongoStore.reserve(stored(report(), agencyId)),
        /giornaliero/,
      );
      assert.equal(await mongoStore.get(extra.id, "different-agency"), null);
      await AuditModel.updateOne(
        { id: extra.id },
        { $set: { shareExpiresAt: new Date(0) } },
      );
      assert.equal(await mongoStore.getByShare(extra.shareHash), null);
      await mongoStore.requestDeletion(extra.id, agencyId);
      assert.equal(await mongoStore.get(extra.id, agencyId), null);
      await assert.rejects(() =>
        purgeReports("/tmp", async () => {
          throw new Error("disk unavailable");
        }),
      );
      assert.ok(await AuditModel.exists({ id: extra.id }));
      let cleaned = false;
      await purgeReports("/tmp", async () => {
        cleaned = true;
      });
      assert.ok(cleaned);
      assert.equal(await AuditModel.exists({ id: extra.id }), null);
      connection = await amqp.connect(secret("RABBIT_URL"));
      channel = await connection.createConfirmChannel();
      await channel.assertQueue(queue, { autoDelete: true });
      channel.sendToQueue(queue, Buffer.from(account.id), { persistent: true });
      await channel.waitForConfirms();
      const message = await channel.get(queue, { noAck: false });
      assert.ok(message);
      assert.equal(message.content.toString(), account.id);
      channel.ack(message);
      // Exercise the actual worker and controlled egress without contacting a third-party site.
      const rejected = stored(report("https://launchcheck-test.invalid/", 1), agencyId);
      await UsageModel.deleteMany({ agencyId });
      await mongoStore.reserve(rejected);
      channel.sendToQueue(
        "launchcheck.audits",
        Buffer.from(JSON.stringify({ id: rejected.id })),
        { persistent: true },
      );
      await channel.waitForConfirms();
      let terminal: any;
      for (let n = 0; n < 90; n++) {
        terminal = await mongoStore.get(rejected.id, agencyId);
        if (terminal?.quotaReleased) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      assert.equal(
        terminal?.quotaReleased,
        true,
        "actual worker must release its reservation",
      );
      assert.equal(terminal?.report.status, "failed");
      assert.equal((await AgencyModel.findOne({ id: agencyId })).active, 0);
      const fetcher = createFetcherClient(
        "http://fetcher:8081",
        secret("FETCHER_TOKEN"),
      );
      await assert.rejects(
        () => fetcher("http://127.0.0.1/"),
        /fetch|request|Fetch|Destination/i,
      );
    } finally {
      if (channel) {
        await channel.deleteQueue(queue);
        await channel.close();
      }
      if (connection) await connection.close();
      // Release any remaining reservation before removing fixtures, even on assertion failure.
      for (const d of await AuditModel.find({
        agencyId,
        quotaReleased: false,
      }).lean()) {
        const r = d.report as any;
        r.status = "failed";
        await mongoStore.finish(String(d.id), r);
      }
      await AuditModel.deleteMany({ agencyId });
      await UsageModel.deleteMany({ agencyId });
      await UserModel.deleteMany({ agencyId });
      await AgencyModel.deleteOne({ id: agencyId });
      await mongoose.disconnect();
    }
  },
);
