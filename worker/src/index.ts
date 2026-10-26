import mongoose from 'mongoose';
import amqp from 'amqplib';
import path from 'node:path';
import { AuditModel, mongoStore } from '@launchcheck/shared';
import { runAudit } from './audit';
async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/launchcheck');
  const connection = await amqp.connect(process.env.RABBIT_URL || 'amqp://localhost:5672');
  const channel = await connection.createChannel(); await channel.assertQueue('launchcheck.audits', { durable: true }); await channel.prefetch(1);
  connection.on('close', () => process.exit(1)); // Restart and recover unacknowledged deliveries.
  await channel.consume('launchcheck.audits', async message => {
    if (!message) return;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      const { id } = JSON.parse(message.content.toString());
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) { channel.nack(message, false, false); return; }
      const doc = await AuditModel.findOneAndUpdate({ id, $or: [{ 'report.status': 'queued' }, { 'report.status': 'running', leaseUntil: { $lt: new Date() } }] }, { $set: { 'report.status': 'running', leaseUntil: new Date(Date.now() + 60_000) } }, { new: true }).lean() as any;
      if (!doc) {
        const existing = await mongoStore.get(id);
        if (existing?.report.status === 'running') {
          // A crashed worker lease may still be alive. Leave the message unacknowledged
          // until it expires, then reconnect instead of dropping the audit forever.
          await new Promise(resolve => setTimeout(resolve, 60_000)); process.exit(1);
        }
        channel.ack(message); return;
      }
      heartbeat = setInterval(() => { AuditModel.updateOne({ id }, { $set: { leaseUntil: new Date(Date.now() + 60_000) } }).catch(() => process.exit(1)); }, 20_000);
      const baseline = doc.report.baselineId ? (await mongoStore.get(doc.report.baselineId))?.report : undefined;
      await runAudit(doc.report, { artifactDir: process.env.ARTIFACT_DIR || path.resolve('artifacts'), baseline, onProgress: report => mongoStore.update(id, { report }) });
      channel.ack(message);
    } catch (err) { console.error('Audit processing failed:', (err as Error).name); process.exit(1); }
    finally { if (heartbeat) clearInterval(heartbeat); }
  });
  console.log('Worker pronto');
  const close = async () => { await channel.close(); await connection.close(); await mongoose.disconnect(); process.exit(0); };
  process.on('SIGTERM', close); process.on('SIGINT', close);
}
main().catch(err => { console.error(err.message); process.exit(1); });
