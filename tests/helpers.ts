import { randomUUID } from "node:crypto";
import type {
  AuditReport,
  StoredAudit,
  ReportStore,
  SafeClient,
} from "@launchcheck/shared";
export function report(
  url = "https://fixture.example/",
  maxPages = 2,
): AuditReport {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    url,
    agency: "Studio Forma",
    client: "Aurora Studio",
    status: "queued",
    createdAt: now,
    updatedAt: now,
    maxPages,
    scannedPages: 0,
    totalPages: 0,
    pages: [],
    findings: [],
    resolvedSinceBaseline: [],
    notes: [],
  };
}
export function memoryStore(): ReportStore & {
  values: Map<string, StoredAudit>;
} {
  const values = new Map<string, StoredAudit>();
  const visible = (v: StoredAudit | undefined, agency?: string) =>
    v &&
    (!agency || v.agencyId === agency) &&
    !v.deletedAt &&
    +new Date(v.expiresAt) > Date.now();
  return {
    values,
    async reserve(value) {
      values.set(value.id, structuredClone(value));
    },
    async get(id, agency) {
      const v = values.get(id);
      return visible(v, agency) ? structuredClone(v!) : null;
    },
    async list(agency) {
      return [...values.values()]
        .filter((v) => visible(v, agency))
        .map((v) => structuredClone(v.report))
        .reverse();
    },
    async getByShare(hash) {
      return structuredClone(
        [...values.values()].find(
          (v) =>
            visible(v) &&
            v.shareHash === hash &&
            +new Date(v.shareExpiresAt) > Date.now(),
        ) || null,
      );
    },
    async update(id, agency, patch) {
      const v = values.get(id);
      if (visible(v, agency)) Object.assign(v!, structuredClone(patch));
    },
    async triage(id, agency, findingId, status) {
      const v = values.get(id);
      const f =
        visible(v, agency) &&
        v!.report.findings.find((f) => f.id === findingId);
      if (!f) return false;
      f.status = status as any;
      return true;
    },
    async finish(id, report) {
      const v = values.get(id);
      if (v)
        Object.assign(v, {
          report: structuredClone(report),
          quotaReleased: true,
        });
    },
    async requestDeletion(id, agency) {
      const v = values.get(id);
      if (!visible(v, agency)) return false;
      v!.deletedAt = new Date();
      return true;
    },
  };
}
export const testPassword = "A long test password 482!";
export async function memoryIdentity() {
  const { hashPassword } = await import("@launchcheck/shared");
  const hash = await hashPassword(testPassword);
  const agencies = new Map(
    ["a", "b"].map((id) => [
      id,
      {
        id,
        name: "Studio Forma",
        enabled: true,
        active: 0,
        concurrencyLimit: 3,
        dailyLimit: 20,
        retentionDays: 30,
        shareDays: 7,
      },
    ]),
  );
  const users = new Map(
    ["owner", "other", "viewer"].map((id, i) => [
      id,
      {
        id,
        agencyId: i === 1 ? "b" : "a",
        email: id + "@example.com",
        name: id,
        role: id === "viewer" ? "viewer" : "owner",
        passwordHash: hash,
        enabled: true,
        authVersion: 1,
      },
    ]),
  );
  const sessions = new Map<string, any>(),
    limits = new Map<string, number>();
  const identities: import("@launchcheck/shared").IdentityStore = {
    async userByEmail(email) {
      return (
        ([...users.values()].find((u) => u.email === email) as any) || null
      );
    },
    async userById(id) {
      return (users.get(id) as any) || null;
    },
    async agency(id) {
      return agencies.get(id) || null;
    },
    async saveSession(s) {
      sessions.set(s.tokenHash, s);
    },
    async session(h) {
      return sessions.get(h) || null;
    },
    async touchSession(h, d) {
      const s = sessions.get(h);
      if (s) s.idleExpiresAt = d;
    },
    async removeSession(h) {
      sessions.delete(h);
    },
    async changePassword(id, agency, hash) {
      const u = users.get(id);
      if (u?.agencyId === agency) {
        u.passwordHash = hash;
        u.authVersion++;
        for (const [h, s] of sessions) if (s.userId === id) sessions.delete(h);
      }
    },
    async consumeLimit(id, _until, max) {
      const n = (limits.get(id) || 0) + 1;
      limits.set(id, n);
      return n <= max;
    },
    async event() {},
  };
  return { identities, users, sessions, agencies };
}
export function stored(value = report(), agencyId = "a"): StoredAudit {
  return {
    id: value.id,
    agencyId,
    createdBy: "owner",
    shareHash: value.id,
    shareExpiresAt: new Date(Date.now() + 86400000),
    expiresAt: new Date(Date.now() + 86400000 * 30),
    quotaReleased: false,
    report: value,
  };
}
export function fixtureClient(
  fixed = false,
  requests: string[] = [],
): SafeClient {
  return async (value, options) => {
    requests.push(value);
    const url = new URL(value);
    if (url.pathname === "/robots.txt")
      return {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: Buffer.from("User-agent: *\nDisallow: /private\n"),
        url: value,
      };
    const missing =
      url.pathname === "/missing" || url.pathname === "/broken.png";
    const html = `<!doctype html><html lang="it"><head><title>Aurora Studio</title><style>body{font:18px Arial;margin:24px;color:#173c2b}header{background:#e4f3d4;padding:28px}main{max-width:900px}.wide{width:${fixed ? "90%" : "700px"};background:#d5eaba;height:80px}img{width:120px;height:80px}h1{font-size:40px}</style></head><body><header><strong>AURORA / STUDIO</strong><h1>Progettiamo il prossimo passo.</h1></header><main><h2>Il tuo progetto, con cura.</h2><div class="wide">Una nuova prospettiva.</div>${fixed ? "" : '<img src="/broken.png" alt="Il nostro studio"/>'}<p><a href="/about">Scopri lo studio</a></p>${fixed ? "" : '<a href="/missing">Richiedi un preventivo</a>'}<a href="/private">Riservato</a><a href="https://external.example/">Partner esterno</a>${fixed ? "" : '<script>fetch("http://127.0.0.1/private").catch(()=>{});setTimeout(()=>{throw new Error("fixture failure")},30)</script>'}</main></body></html>`;
    return {
      status: missing ? 404 : 200,
      headers: {
        "content-type": missing ? "text/plain" : "text/html; charset=utf-8",
      },
      body:
        options?.method === "HEAD"
          ? Buffer.alloc(0)
          : Buffer.from(missing ? "Not found" : html),
      url: value,
    };
  };
}
