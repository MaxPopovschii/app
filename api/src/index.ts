import path from "node:path";
import mongoose from "mongoose";
import amqp from "amqplib";
import {
  mongoStore,
  AuditModel,
  CapacityModel,
  HeartbeatModel,
  workerHealthy,
  secret,
  publicOrigin,
} from "@launchcheck/shared";
import { createApp } from "./app";
async function main() {
  const origin = publicOrigin(),
    authSecret = secret("AUTH_SECRET"),
    metricsToken = secret("METRICS_TOKEN");
  await mongoose.connect(secret("MONGO_URI"), {
    serverSelectionTimeoutMS: 5000,
  });
  await CapacityModel.updateOne(
    { id: "global" },
    {
      $set: { limit: Number(process.env.GLOBAL_CONCURRENCY_LIMIT || 12) },
      $setOnInsert: { active: 0 },
    },
    { upsert: true },
  );
  const connection = await amqp.connect(secret("RABBIT_URL"));
  const channel = await connection.createConfirmChannel();
  await channel.assertQueue("launchcheck.audits", { durable: true });
  connection.on("close", () => process.exit(1));
  const enqueue = async (id: string) => {
    channel.sendToQueue(
      "launchcheck.audits",
      Buffer.from(JSON.stringify({ id })),
      { persistent: true },
    );
    await channel.waitForConfirms();
  };
  const recover = async () => {
    const stale = await AuditModel.find({
      deletedAt: null,
      expiresAt: { $gt: new Date() },
      quotaReleased: false,
      $or: [
        {
          "report.status": "queued",
          updatedAt: { $lt: new Date(Date.now() - 30_000) },
        },
        { "report.status": "running", leaseUntil: { $lt: new Date() } },
      ],
    })
      .select("id")
      .limit(20)
      .lean();
    for (const item of stale) await enqueue(String(item.id));
  };
  let recovering = false;
  const recoveryTimer = setInterval(() => {
    if (recovering) return;
    recovering = true;
    recover()
      .catch(() =>
        console.error(JSON.stringify({ event: "queue_recovery_failed" })),
      )
      .finally(() => {
        recovering = false;
      });
  }, 30_000);
  const readiness = async () => {
    const checks = {
      database: false,
      queue: false,
      worker: false,
      fetcher: false,
    };
    await Promise.all([
      mongoose.connection
        .db!.command({ ping: 1 }, { timeoutMS: 2000 })
        .then(() => {
          checks.database = true;
        })
        .catch(() => {}),
      Promise.race([
        channel.checkQueue("launchcheck.audits"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 2000),
        ),
      ])
        .then(() => {
          checks.queue = true;
        })
        .catch(() => {}),
      workerHealthy()
        .then((ok) => {
          checks.worker = ok;
        })
        .catch(() => {}),
      HeartbeatModel.exists({
        updatedAt: { $gte: new Date(Date.now() - 45_000) },
        fetcherHealthy: true,
      })
        .then((value) => {
          checks.fetcher = Boolean(value);
        })
        .catch(() => {}),
    ]);
    return { ready: Object.values(checks).every(Boolean), checks };
  };
  const metrics = async () => {
    const ready = await readiness();
    const failures = await AuditModel.countDocuments({
      "report.status": "failed",
      updatedAt: { $gte: new Date(Date.now() - 15 * 60_000) },
    });
    const waiting = await AuditModel.countDocuments({
      "report.status": "queued",
      quotaReleased: false,
      deletedAt: null,
    });
    const stale = await AuditModel.countDocuments({
      "report.status": "queued",
      updatedAt: { $lt: new Date(Date.now() - 10 * 60_000) },
      quotaReleased: false,
      deletedAt: null,
    });
    return `# TYPE launchcheck_ready gauge\nlaunchcheck_ready ${Number(ready.ready)}\n# TYPE launchcheck_worker_up gauge\nlaunchcheck_worker_up ${Number(ready.checks.worker)}\n# TYPE launchcheck_recent_failed_reports gauge\nlaunchcheck_recent_failed_reports ${failures}\n# TYPE launchcheck_queued_reports gauge\nlaunchcheck_queued_reports ${waiting}\n# TYPE launchcheck_stale_queued_reports gauge\nlaunchcheck_stale_queued_reports ${stale}\n`;
  };
  const app = createApp({
    store: mongoStore,
    authSecret,
    secureCookies: process.env.COOKIE_SECURE === "true",
    publicOrigin: origin,
    trustProxyHops: process.env.TRUST_PROXY_HOPS === "1" ? 1 : 0,
    metrics,
    metricsToken,
    readiness,
    artifactDir: process.env.ARTIFACT_DIR || path.resolve("artifacts"),
    webDir: process.env.WEB_DIR || path.resolve(__dirname, "../../web/dist"),
    enqueue,
  });
  const server = app.listen(Number(process.env.PORT || 8080), "0.0.0.0", () =>
    console.log(JSON.stringify({ event: "api_ready" })),
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    clearInterval(recoveryTimer);
    const forced = setTimeout(() => process.exit(1), 20_000);
    forced.unref();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await channel.close();
    await connection.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
}
main().catch((err) => {
  console.error(JSON.stringify({ event: "api_start_failed", type: err.name }));
  process.exit(1);
});
