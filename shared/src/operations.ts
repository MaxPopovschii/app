import mongoose from "mongoose";
const schema = new mongoose.Schema({
  id: { type: String, unique: true },
  updatedAt: Date,
  diskHealthy: Boolean,
  fetcherHealthy: Boolean,
  expiresAt: Date,
});
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const HeartbeatModel =
  mongoose.models.Heartbeat || mongoose.model("Heartbeat", schema);
export async function workerHealthy() {
  return Boolean(
    await HeartbeatModel.exists({
      updatedAt: { $gte: new Date(Date.now() - 45_000) },
      diskHealthy: true,
    }),
  );
}
