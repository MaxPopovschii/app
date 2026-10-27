import mongoose from "mongoose";
import {
  randomUUID,
  randomBytes,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { Agency, AgencyModel } from "./model";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const derive = promisify(scrypt) as any;
let hashing = 0;
const waiters: (() => void)[] = [];
async function kdf(password: string, salt: string): Promise<Buffer> {
  if (waiters.length >= 16)
    throw new Error("Authentication temporarily at capacity");
  if (hashing >= 2) await new Promise<void>((resolve) => waiters.push(resolve));
  hashing++;
  try {
    return await derive(password, salt, 64, {
      N: 131072,
      r: 8,
      p: 1,
      maxmem: 256 * 1024 * 1024,
    });
  } finally {
    hashing--;
    waiters.shift()?.();
  }
}
export function validPassword(password: unknown): password is string {
  return (
    typeof password === "string" &&
    [...password].length >= 15 &&
    [...password].length <= 128
  );
}
export async function hashPassword(password: string) {
  if (!validPassword(password))
    throw new Error("Usa una password da 15 a 128 caratteri");
  const salt = randomBytes(16).toString("hex");
  return `scrypt$131072$8$1$${salt}$${(await kdf(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: unknown, encoded: string) {
  if (typeof password !== "string" || [...password].length > 128) return false;
  const parts = encoded.split("$");
  if (
    parts.length !== 6 ||
    parts.slice(0, 4).join("$") !== "scrypt$131072$8$1" ||
    !/^[a-f0-9]{32}$/.test(parts[4]) ||
    !/^[a-f0-9]{128}$/.test(parts[5])
  )
    return false;
  return timingSafeEqual(
    await kdf(password, parts[4]),
    Buffer.from(parts[5], "hex"),
  );
}
export type Role = "owner" | "member" | "viewer";
export interface User {
  id: string;
  agencyId: string;
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
  enabled: boolean;
  authVersion: number;
}
export interface Session {
  tokenHash: string;
  userId: string;
  authVersion: number;
  expiresAt: Date;
  idleExpiresAt: Date;
}
const userSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true },
    agencyId: { type: String, required: true, index: true },
    email: { type: String, required: true, unique: true },
    name: String,
    role: { type: String, enum: ["owner", "member", "viewer"] },
    passwordHash: String,
    enabled: { type: Boolean, default: true },
    authVersion: { type: Number, default: 1 },
  },
  { timestamps: true },
);
const sessionSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, unique: true },
    userId: { type: String, index: true },
    authVersion: Number,
    expiresAt: Date,
    idleExpiresAt: Date,
  },
  { timestamps: true },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const limitSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  count: Number,
  expiresAt: Date,
});
limitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const eventSchema = new mongoose.Schema(
  {
    type: String,
    agencyId: String,
    actorId: String,
    targetId: String,
    expiresAt: Date,
  },
  { timestamps: true },
);
eventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const UserModel =
  mongoose.models.User || mongoose.model("User", userSchema);
export const SessionModel =
  mongoose.models.Session || mongoose.model("Session", sessionSchema);
export const LimitModel =
  mongoose.models.AuthLimit || mongoose.model("AuthLimit", limitSchema);
export const SecurityEventModel =
  mongoose.models.SecurityEvent || mongoose.model("SecurityEvent", eventSchema);
export interface IdentityStore {
  userByEmail(email: string): Promise<User | null>;
  userById(id: string): Promise<User | null>;
  agency(id: string): Promise<Agency | null>;
  saveSession(value: Session): Promise<void>;
  session(hash: string): Promise<Session | null>;
  touchSession(hash: string, idleUntil: Date): Promise<void>;
  removeSession(hash: string): Promise<void>;
  changePassword(id: string, agencyId: string, hash: string): Promise<void>;
  consumeLimit(id: string, expires: Date, maximum: number): Promise<boolean>;
  event(
    type: string,
    agencyId?: string,
    actorId?: string,
    targetId?: string,
  ): Promise<void>;
}
export const mongoIdentity: IdentityStore = {
  async userByEmail(email) {
    return UserModel.findOne({ email }).lean() as any;
  },
  async userById(id) {
    return UserModel.findOne({ id }).lean() as any;
  },
  async agency(id) {
    return AgencyModel.findOne({ id, enabled: true }).lean() as any;
  },
  async saveSession(value) {
    await SessionModel.create(value);
  },
  async session(tokenHash) {
    return SessionModel.findOne({ tokenHash }).lean() as any;
  },
  async touchSession(tokenHash, idleExpiresAt) {
    await SessionModel.updateOne({ tokenHash }, { $set: { idleExpiresAt } });
  },
  async removeSession(tokenHash) {
    await SessionModel.deleteOne({ tokenHash });
  },
  async changePassword(id, agencyId, passwordHash) {
    await UserModel.updateOne(
      { id, agencyId },
      { $set: { passwordHash }, $inc: { authVersion: 1 } },
    );
    await SessionModel.deleteMany({ userId: id });
  },
  async consumeLimit(id, expiresAt, maximum) {
    let value;
    try {
      value = await LimitModel.findOneAndUpdate(
        { id },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
        { upsert: true, new: true },
      );
    } catch (err: any) {
      if (err.code !== 11000) throw err;
      value = await LimitModel.findOneAndUpdate(
        { id },
        { $inc: { count: 1 } },
        { new: true },
      );
    }
    return (value?.count || maximum + 1) <= maximum;
  },
  async event(type, agencyId, actorId, targetId) {
    await SecurityEventModel.create({
      type,
      agencyId,
      actorId,
      targetId,
      expiresAt: new Date(Date.now() + 90 * 86400_000),
    });
  },
};
export async function provisionAccount(input: {
  agencyId?: string;
  agency: string;
  email: string;
  name: string;
  role?: Role;
  password: string;
}) {
  const email = input.email.trim().toLowerCase();
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    !input.name.trim() ||
    input.name.length > 100 ||
    !input.agency.trim() ||
    input.agency.length > 100
  )
    throw new Error("Dati account non validi");
  const passwordHash = await hashPassword(input.password),
    agencyId = input.agencyId || randomUUID(),
    id = randomUUID();
  await mongoose.connection.transaction(async (session) => {
    if (!input.agencyId)
      await AgencyModel.create([{ id: agencyId, name: input.agency.trim() }], {
        session,
      });
    else if (
      !(await AgencyModel.findOne({ id: agencyId, enabled: true }).session(
        session,
      ))
    )
      throw new Error("Agenzia non trovata");
    await UserModel.create(
      [
        {
          id,
          agencyId,
          email,
          name: input.name.trim(),
          role: input.role || (input.agencyId ? "member" : "owner"),
          passwordHash,
          enabled: true,
          authVersion: 1,
        },
      ],
      { session },
    );
  });
  return { id, agencyId, email };
}
