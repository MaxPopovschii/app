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
export function memoryStore(): ReportStore {
  const values = new Map<string, StoredAudit>();
  return {
    async create(value) {
      values.set(value.id, structuredClone(value));
    },
    async get(id) {
      return structuredClone(values.get(id) || null);
    },
    async list() {
      return [...values.values()]
        .map((v) => structuredClone(v.report))
        .reverse();
    },
    async getByShare(hash) {
      return structuredClone(
        [...values.values()].find((v) => v.shareHash === hash) || null,
      );
    },
    async update(id, patch) {
      const old = values.get(id);
      if (old) values.set(id, structuredClone({ ...old, ...patch }));
    },
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
