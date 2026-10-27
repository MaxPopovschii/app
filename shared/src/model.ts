import mongoose from "mongoose";
import { AuditReport } from "./types";
export class QuotaError extends Error {}
const auditSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    agencyId: { type: String, required: true, index: true },
    createdBy: { type: String, required: true },
    shareHash: { type: String, required: true, unique: true },
    shareExpiresAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    deletedAt: { type: Date, default: null },
    quotaReleased: { type: Boolean, default: false },
    report: { type: mongoose.Schema.Types.Mixed, required: true },
    leaseUntil: Date,
    leaseOwner: String,
  },
  { timestamps: true },
);
auditSchema.index({ agencyId: 1, deletedAt: 1, createdAt: -1 });
auditSchema.index({ "report.status": 1, updatedAt: 1 });
const agencySchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    active: { type: Number, default: 0 },
    concurrencyLimit: { type: Number, default: 3 },
    dailyLimit: { type: Number, default: 20 },
    retentionDays: { type: Number, default: 30 },
    shareDays: { type: Number, default: 7 },
  },
  { timestamps: true },
);
const usageSchema = new mongoose.Schema({
  agencyId: String,
  day: String,
  used: Number,
  expiresAt: Date,
});
usageSchema.index({ agencyId: 1, day: 1 }, { unique: true });
usageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AuditModel =
  mongoose.models.Audit || mongoose.model("Audit", auditSchema);
export const AgencyModel =
  mongoose.models.Agency || mongoose.model("Agency", agencySchema);
const capacitySchema = new mongoose.Schema({
  id: { type: String, unique: true },
  active: { type: Number, default: 0 },
  limit: { type: Number, default: 12 },
});
export const CapacityModel =
  mongoose.models.Capacity || mongoose.model("Capacity", capacitySchema);
export const UsageModel =
  mongoose.models.Usage || mongoose.model("Usage", usageSchema);
export interface Agency {
  id: string;
  name: string;
  enabled: boolean;
  active: number;
  concurrencyLimit: number;
  dailyLimit: number;
  retentionDays: number;
  shareDays: number;
}
export interface StoredAudit {
  id: string;
  agencyId: string;
  createdBy: string;
  shareHash: string;
  shareExpiresAt: Date;
  expiresAt: Date;
  deletedAt?: Date | null;
  quotaReleased: boolean;
  report: AuditReport;
}
export interface ReportStore {
  reserve(value: StoredAudit): Promise<void>;
  get(id: string, agencyId: string): Promise<StoredAudit | null>;
  list(agencyId: string): Promise<AuditReport[]>;
  getByShare(hash: string): Promise<StoredAudit | null>;
  update(
    id: string,
    agencyId: string,
    patch: Pick<Partial<StoredAudit>, "shareHash" | "shareExpiresAt">,
  ): Promise<void>;
  triage(
    id: string,
    agencyId: string,
    findingId: string,
    status: string,
  ): Promise<boolean>;
  finish(id: string, report: AuditReport, leaseOwner?: string): Promise<void>;
  requestDeletion(id: string, agencyId: string): Promise<boolean>;
}
const visible = () => ({ deletedAt: null, expiresAt: { $gt: new Date() } });
export const mongoStore: ReportStore = {
  async reserve(value) {
    await mongoose.connection.transaction(async (session) => {
      // Serialize admissions on the agency document. The report, daily usage and
      // active reservation commit together; concurrent requests cannot overbook.
      const capacity = await CapacityModel.findOneAndUpdate(
        { id: "global", $expr: { $lt: ["$active", "$limit"] } },
        { $inc: { active: 1 } },
        { new: true, session },
      );
      if (!capacity)
        throw new QuotaError("Capacità globale temporaneamente esaurita");
      const agency = await AgencyModel.findOneAndUpdate(
        {
          id: value.agencyId,
          enabled: true,
          $expr: { $lt: ["$active", "$concurrencyLimit"] },
        },
        { $inc: { active: 1 } },
        { new: true, session },
      );
      if (!agency)
        throw new QuotaError("Limite di scansioni simultanee raggiunto");
      const day = new Date().toISOString().slice(0, 10);
      const usage = await UsageModel.findOne({
        agencyId: value.agencyId,
        day,
      }).session(session);
      if ((usage?.used || 0) >= agency.dailyLimit)
        throw new QuotaError("Limite giornaliero di scansioni raggiunto");
      if (usage) {
        usage.used++;
        await usage.save({ session });
      } else
        await UsageModel.create(
          [
            {
              agencyId: value.agencyId,
              day,
              used: 1,
              expiresAt: new Date(Date.now() + 90 * 86400_000),
            },
          ],
          { session },
        );
      await AuditModel.create([value], { session });
    });
  },
  async get(id, agencyId) {
    return AuditModel.findOne({ id, agencyId, ...visible() }).lean() as any;
  },
  async list(agencyId) {
    const docs = await AuditModel.find({ agencyId, ...visible() })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return docs.map((d) => d.report as AuditReport);
  },
  async getByShare(shareHash) {
    const doc = (await AuditModel.findOne({
      shareHash,
      agencyId: { $type: "string" },
      shareExpiresAt: { $gt: new Date() },
      ...visible(),
    }).lean()) as any;
    return doc &&
      (await AgencyModel.exists({ id: doc.agencyId, enabled: true }))
      ? doc
      : null;
  },
  async update(id, agencyId, patch) {
    await AuditModel.updateOne({ id, agencyId, ...visible() }, { $set: patch });
  },
  async triage(id, agencyId, findingId, status) {
    const result = await AuditModel.updateOne(
      {
        id,
        agencyId,
        ...visible(),
        "report.status": { $in: ["complete", "partial", "failed"] },
        "report.findings.id": findingId,
      },
      {
        $set: {
          "report.findings.$.status": status,
          "report.updatedAt": new Date().toISOString(),
        },
      },
    );
    return result.matchedCount === 1;
  },
  async finish(id, report, leaseOwner) {
    await mongoose.connection.transaction(async (session) => {
      const filter: any = { id, quotaReleased: false };
      if (leaseOwner) filter.leaseOwner = leaseOwner;
      const doc = await AuditModel.findOne(filter).session(session);
      if (!doc) return;
      await CapacityModel.updateOne(
        { id: "global", active: { $gt: 0 } },
        { $inc: { active: -1 } },
        { session },
      );
      await AgencyModel.updateOne(
        { id: doc.agencyId, active: { $gt: 0 } },
        { $inc: { active: -1 } },
        { session },
      );
      await AuditModel.updateOne(
        filter,
        {
          $set: { report, quotaReleased: true },
          $unset: { leaseUntil: 1, leaseOwner: 1 },
        },
        { session },
      );
    });
  },
  async requestDeletion(id, agencyId) {
    const result = await AuditModel.updateOne(
      {
        id,
        agencyId,
        ...visible(),
        "report.status": { $in: ["complete", "partial", "failed"] },
      },
      { $set: { deletedAt: new Date(), shareExpiresAt: new Date(0) } },
    );
    return result.matchedCount === 1;
  },
};
export async function purgeReports(
  artifactDir: string,
  remove: (directory: string) => Promise<void>,
) {
  const expiredActive = await AuditModel.find({
    expiresAt: { $lte: new Date() },
    quotaReleased: false,
  })
    .limit(20)
    .lean();
  for (const doc of expiredActive) {
    const report = doc.report as AuditReport;
    report.status = "failed";
    report.error = "Verifica scaduta prima del completamento";
    report.completedAt = new Date().toISOString();
    await mongoStore.finish(String(doc.id), report);
  }
  const candidates = await AuditModel.find({
    $or: [
      { deletedAt: { $ne: null } },
      {
        expiresAt: { $lte: new Date() },
        "report.status": { $in: ["complete", "partial", "failed"] },
      },
    ],
  })
    .select("id")
    .limit(50)
    .lean();
  for (const doc of candidates) {
    const id = String(doc.id);
    if (!/^[a-f0-9-]{36}$/.test(id)) continue;
    // Hide first; remove files before removing the tombstone so failed cleanup retries.
    await AuditModel.updateOne(
      { id },
      { $set: { deletedAt: new Date(), shareExpiresAt: new Date(0) } },
    );
    await remove(`${artifactDir}/${id}`);
    await AuditModel.deleteOne({ id, deletedAt: { $ne: null } });
  }
}
