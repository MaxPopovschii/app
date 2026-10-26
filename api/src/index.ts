import path from 'node:path';
import mongoose from 'mongoose';
import amqp from 'amqplib';
import { mongoStore, AuditModel } from '@launchcheck/shared';
import { createApp } from './app';
async function main() {
  if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.length < 32) throw new Error('Imposta ADMIN_TOKEN (almeno 32 caratteri)');
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/launchcheck');
  const connection = await amqp.connect(process.env.RABBIT_URL || 'amqp://localhost:5672');
  const channel = await connection.createConfirmChannel(); await channel.assertQueue('launchcheck.audits', { durable: true });
  connection.on('close', () => process.exit(1));
  const enqueue = async (id: string) => { channel.sendToQueue('launchcheck.audits', Buffer.from(JSON.stringify({ id })), { persistent: true }); await channel.waitForConfirms(); };
  const recover = async () => {
    const stale = await AuditModel.find({ $or: [ { 'report.status': 'queued', updatedAt: { $lt: new Date(Date.now() - 30_000) } }, { 'report.status': 'running', leaseUntil: { $lt: new Date() } } ] }).select('id').limit(20).lean();
    for (const item of stale) await enqueue(String(item.id));
  };
  const recoveryTimer = setInterval(() => { recover().catch(() => console.error('Recovery temporarily unavailable')); }, 30_000);
  const app = createApp({ store: mongoStore, adminToken: process.env.ADMIN_TOKEN,
    artifactDir: process.env.ARTIFACT_DIR || path.resolve('artifacts'), webDir: process.env.WEB_DIR || path.resolve(__dirname, '../../web/dist'),
    enqueue
  });
  const server = app.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('LaunchCheck pronto'));
  const close = async () => { clearInterval(recoveryTimer); server.close(); await channel.close(); await connection.close(); await mongoose.disconnect(); process.exit(0); };
  process.on('SIGTERM', close); process.on('SIGINT', close);
}
main().catch(err => { console.error(err.message); process.exit(1); });
