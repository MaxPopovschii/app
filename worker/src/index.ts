import mongoose from "mongoose";
import amqp from "amqplib";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, rm, statfs, writeFile, unlink } from "node:fs/promises";
import {
  AuditModel,
  mongoStore,
  secret,
  HeartbeatModel,
  purgeReports,
  createFetcherClient,
  isFinished,
} from "@launchcheck/shared";
import { runAudit } from "./audit";
async function main() {
  const artifactDir = path.resolve(process.env.ARTIFACT_DIR || "artifacts"),
    instance = randomUUID();
  await mkdir(artifactDir, { recursive: true });
  const client = createFetcherClient(
    process.env.FETCHER_URL || "http://fetcher:8081",
    secret("FETCHER_TOKEN"),
  );
  await mongoose.connect(secret("MONGO_URI"), {
    serverSelectionTimeoutMS: 5000,
  });
  const connection = await amqp.connect(secret("RABBIT_URL"));
  const channel = await connection.createConfirmChannel();
  await channel.assertQueue("launchcheck.audits", { durable: true });
  await channel.assertQueue("launchcheck.retry", {
    durable: true,
    arguments: {
      "x-message-ttl": 30_000,
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": "launchcheck.audits",
    },
  });
  await channel.prefetch(1);
  connection.on("close", () => process.exit(1));
  const beat = async () => {
    let diskHealthy = false;
    try {
      const info = await statfs(artifactDir);
      const probe = path.join(artifactDir, ".health-" + instance);
      await writeFile(probe, "ok");
      await unlink(probe);
      diskHealthy =
        info.bavail * info.bsize >=
        Number(process.env.MIN_FREE_DISK_BYTES || 1_000_000_000);
    } catch {}
    let fetcherHealthy = false;
    try {
      fetcherHealthy = (
        await fetch(
          new URL("/readyz", process.env.FETCHER_URL || "http://fetcher:8081"),
          { signal: AbortSignal.timeout(2000) },
        )
      ).ok;
    } catch {}
    await HeartbeatModel.updateOne(
      { id: instance },
      {
        $set: {
          updatedAt: new Date(),
          diskHealthy,
          fetcherHealthy,
          expiresAt: new Date(Date.now() + 120_000),
        },
      },
      { upsert: true },
    );
  };
  await beat();
  const beats = setInterval(() => {
    beat().catch(() => process.exit(1));
  }, 15_000);
  let cleaning = false;
  const clean = async () => {
    if (cleaning) return;
    cleaning = true;
    try {
      await purgeReports(artifactDir, (dir) =>
        rm(dir, { recursive: true, force: true }),
      );
    } finally {
      cleaning = false;
    }
  };
  const janitor = setInterval(() => {
    clean().catch(() =>
      console.error(JSON.stringify({ event: "retention_cleanup_failed" })),
    );
  }, 60_000);
  await clean();
  await channel.consume("launchcheck.audits", async (message) => {
    if (!message) return;
    let lease: ReturnType<typeof setInterval> | undefined;
    try {
      const { id } = JSON.parse(message.content.toString());
      if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) {
        channel.nack(message, false, false);
        return;
      }
      const doc = (await AuditModel.findOneAndUpdate(
        {
          id,
          deletedAt: null,
          expiresAt: { $gt: new Date() },
          quotaReleased: false,
          $or: [
            { "report.status": "queued" },
            { "report.status": "running", leaseUntil: { $lt: new Date() } },
          ],
        },
        {
          $set: {
            "report.status": "running",
            leaseUntil: new Date(Date.now() + 60_000),
            leaseOwner: instance,
          },
        },
        { new: true },
      ).lean()) as any;
      if (!doc) {
        const pending = await AuditModel.exists({
          id,
          "report.status": "running",
          quotaReleased: false,
        });
        if (pending) {
          channel.sendToQueue("launchcheck.retry", message.content, {
            persistent: true,
          });
          await channel.waitForConfirms();
        }
        channel.ack(message);
        return;
      }
      lease = setInterval(() => {
        AuditModel.updateOne(
          { id, leaseOwner: instance, quotaReleased: false },
          { $set: { leaseUntil: new Date(Date.now() + 60_000) } },
        )
          .then((value) => {
            if (!value.matchedCount) process.exit(1);
          })
          .catch(() => process.exit(1));
      }, 20_000);
      const baseline = doc.report.baselineId
        ? (await mongoStore.get(doc.report.baselineId, doc.agencyId))?.report
        : undefined;
      const report = await runAudit(doc.report, {
        artifactDir,
        client,
        baseline,
        onProgress: async (progress) => {
          if (isFinished(progress.status)) return;
          const changed = await AuditModel.updateOne(
            { id, leaseOwner: instance, quotaReleased: false, deletedAt: null },
            { $set: { report: progress } },
          );
          if (!changed.matchedCount) throw new Error("Audit lease lost");
        },
      });
      await mongoStore.finish(id, report, instance);
      channel.ack(message);
      console.log(
        JSON.stringify({ event: "audit_finished", id, status: report.status }),
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "audit_processing_failed",
          type: (err as Error).name,
        }),
      );
      process.exit(1);
    } finally {
      if (lease) clearInterval(lease);
    }
  });
  console.log("Worker pronto");
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    clearInterval(beats);
    clearInterval(janitor);
    await HeartbeatModel.deleteOne({ id: instance });
    await channel.close();
    await connection.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
}
main().catch((err) => {
  console.error(
    JSON.stringify({ event: "worker_start_failed", type: err.name }),
  );
  process.exit(1);
});
