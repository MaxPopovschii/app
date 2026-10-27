import mongoose from "mongoose";
import { AuditReport } from "./types";
const schema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    shareHash: { type: String, required: true, unique: true },
    report: { type: mongoose.Schema.Types.Mixed, required: true },
    leaseUntil: Date,
  },
  { timestamps: true },
);
schema.index({ "report.status": 1, createdAt: -1 });
export interface StoredAudit {
  id: string;
  shareHash: string;
  report: AuditReport;
}
export const AuditModel =
  mongoose.models.Audit || mongoose.model("Audit", schema);
export interface ReportStore {
  create(value: StoredAudit): Promise<void>;
  get(id: string): Promise<StoredAudit | null>;
  list(): Promise<AuditReport[]>;
  getByShare(hash: string): Promise<StoredAudit | null>;
  update(id: string, patch: Partial<StoredAudit>): Promise<void>;
}
export const mongoStore: ReportStore = {
  async create(value) {
    await AuditModel.create(value);
  },
  async get(id) {
    return AuditModel.findOne({ id }).lean() as any;
  },
  async list() {
    const docs = await AuditModel.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return docs.map((d) => d.report as AuditReport);
  },
  async getByShare(shareHash) {
    return AuditModel.findOne({ shareHash }).lean() as any;
  },
  async update(id, patch) {
    await AuditModel.updateOne({ id }, { $set: patch });
  },
};
