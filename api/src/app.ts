import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  AuditReport,
  ReportStore,
  normalizeTarget,
  isFinished,
  IdentityStore,
  mongoIdentity,
  QuotaError,
  StoredAudit,
} from "@launchcheck/shared";
import { authLayer, Identity, safeUser } from "./auth";
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const wrap =
  (fn: (req: Request, res: Response) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
export interface AppOptions {
  store: ReportStore;
  identities?: IdentityStore;
  authSecret: string;
  secureCookies: boolean;
  publicOrigin: string;
  trustProxyHops?: 0 | 1;
  readiness?: () => Promise<{
    ready: boolean;
    checks: Record<string, boolean>;
  }>;
  metrics?: () => Promise<string>;
  metricsToken?: string;
  enqueue: (id: string) => Promise<void>;
  artifactDir: string;
  webDir?: string;
}
export function createApp(options: AppOptions) {
  const identities = options.identities || mongoIdentity;
  const auth = authLayer({
    identities,
    secret: options.authSecret,
    secureCookies: options.secureCookies,
    get publicOrigin() {
      return options.publicOrigin;
    },
  });
  const identity = (res: Response) => res.locals.identity as Identity;
  const owned = (req: Request, res: Response) =>
    store.get(req.params.id, identity(res).agency.id);
  const editor = auth.requireEditor;
  const { store } = options;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", options.trustProxyHops || false);
  app.use((req, res, next) => {
    const id = randomUUID(),
      started = Date.now();
    res.set("X-Request-ID", id);
    res.on("finish", () =>
      console.log(
        JSON.stringify({
          event: "request",
          requestId: id,
          method: req.method,
          route: req.route?.path || "unmatched",
          status: res.statusCode,
          durationMs: Date.now() - started,
        }),
      ),
    );
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
      referrerPolicy: { policy: "no-referrer" },
    }),
  );
  app.use(express.json({ limit: "400kb" }));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/healthz", (_req, res) =>
    res.json({ status: "ok", product: "LaunchCheck" }),
  );
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 240,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );
  app.get(
    "/readyz",
    wrap(async (_req, res) => {
      const state = (await options.readiness?.()) || {
        ready: false,
        checks: { configuration: false },
      };
      res.status(state.ready ? 200 : 503).json(state);
    }),
  );
  app.get(
    "/metrics",
    wrap(async (req, res) => {
      if (
        !options.metricsToken ||
        hashToken(req.get("Authorization") || "") !==
          hashToken("Bearer " + options.metricsToken)
      )
        return res.status(401).end();
      res
        .type("text/plain; version=0.0.4")
        .send((await options.metrics?.()) || "");
    }),
  );
  app.get(
    "/api/status",
    auth.requireAuth,
    wrap(async (_req, res) => {
      const state = await options.readiness?.();
      res
        .status(state?.ready ? 200 : 503)
        .json({ ready: Boolean(state?.ready) });
    }),
  );
  app.post("/api/auth/login", wrap(auth.login));
  app.get("/api/auth/session", auth.requireAuth, (_req, res) =>
    res.json({ user: safeUser(identity(res)), csrfToken: identity(res).csrf }),
  );
  app.post("/api/auth/logout", auth.requireAuth, wrap(auth.logout));
  app.post("/api/auth/password", auth.requireAuth, wrap(auth.changePassword));
  const dto = (doc: StoredAudit) => ({
    ...doc.report,
    retentionUntil: new Date(doc.expiresAt).toISOString(),
    shareExpiresAt: new Date(doc.shareExpiresAt).toISOString(),
  });
  const publicReport = (doc: StoredAudit) => ({
    ...dto(doc),
    error: doc.report.error
      ? "Scansione non completata. Contatta l’agenzia."
      : undefined,
  });
  const asset = async (res: Response, report: AuditReport, file: string) => {
    const allowed = new Set(
      report.pages
        .flatMap((p) => [p.screenshot, p.diffScreenshot])
        .filter(Boolean),
    );
    if (
      !/^\d{1,2}-(desktop|mobile)(-diff)?\.png$/.test(file) ||
      !allowed.has(file)
    )
      return res.status(404).json({ error: "Immagine non trovata" });
    res.sendFile(path.resolve(options.artifactDir, report.id, file), (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  };
  app.get(
    "/api/share/:token",
    wrap(async (req, res) => {
      const doc = await store.getByShare(hashToken(req.params.token));
      if (!doc)
        return res
          .status(404)
          .json({ error: "Report non trovato o link revocato" });
      res.json(publicReport(doc));
    }),
  );
  app.get(
    "/api/share/:token/assets/:file",
    wrap(async (req, res) => {
      const doc = await store.getByShare(hashToken(req.params.token));
      if (!doc) return res.status(404).end();
      await asset(res, doc.report, req.params.file);
    }),
  );
  app.use("/api/reports", auth.requireAuth);
  app.get(
    "/api/reports",
    wrap(async (_req, res) => {
      res.json(
        (await store.list(identity(res).agency.id)).map(
          ({ pages, findings, resolvedSinceBaseline, logo, ...report }) => ({
            ...report,
            findingCount: findings.length,
            highCount: findings.filter(
              (f) => f.severity === "high" && f.status === "open",
            ).length,
          }),
        ),
      );
    }),
  );
  app.post(
    "/api/reports",
    editor,
    rateLimit({
      windowMs: 3_600_000,
      limit: 10,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
    wrap(async (req, res) => {
      const {
        url,
        agency,
        client,
        logo,
        maxPages = 5,
        baselineId,
        authorized,
      } = req.body || {};
      if (options.readiness && !(await options.readiness()).ready)
        return res.status(503).json({
          error:
            "Scansioni temporaneamente non disponibili. Riprova più tardi.",
        });
      const account = identity(res);
      let target: URL;
      try {
        target = normalizeTarget(typeof url === "string" ? url : "");
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }
      if (authorized !== true)
        return res.status(400).json({
          error: "Conferma di essere autorizzato a verificare il sito",
        });
      if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10)
        return res.status(400).json({ error: "Scegli da 1 a 10 pagine" });
      if (
        ![client].every(
          (v) =>
            typeof v === "string" && v.trim().length > 0 && v.length <= 100,
        )
      )
        return res.status(400).json({
          error: "Agenzia e cliente sono obbligatori (massimo 100 caratteri)",
        });
      if (
        logo !== undefined &&
        (typeof logo !== "string" ||
          !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(logo) ||
          logo.length > 280_000)
      )
        return res
          .status(400)
          .json({ error: "Il logo deve essere PNG/JPEG e inferiore a 200 KB" });
      if (logo) {
        const bytes = Buffer.from(logo.split(",")[1], "base64");
        const png = bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        if (bytes.length > 200_000 || !(png || jpeg))
          return res
            .status(400)
            .json({ error: "Logo raster non valido o troppo grande" });
      }
      if (baselineId) {
        if (typeof baselineId !== "string")
          return res.status(400).json({ error: "Baseline non valida" });
        const baseline = (await store.get(baselineId, account.agency.id))
          ?.report;
        if (
          !baseline ||
          !["complete", "partial"].includes(baseline.status) ||
          new URL(baseline.url).origin !== target.origin
        )
          return res.status(400).json({
            error:
              "La baseline deve essere una scansione conclusa dello stesso sito",
          });
      }
      const id = randomUUID(),
        token = randomBytes(32).toString("base64url"),
        now = new Date().toISOString();
      const report: AuditReport = {
        id,
        url: target.href,
        agency: account.agency.name,
        client: client.trim(),
        logo,
        status: "queued",
        createdAt: now,
        updatedAt: now,
        maxPages,
        scannedPages: 0,
        totalPages: 0,
        baselineId,
        pages: [],
        findings: [],
        resolvedSinceBaseline: [],
        notes: [],
      };
      try {
        await store.reserve({
          id,
          agencyId: account.agency.id,
          createdBy: account.user.id,
          shareHash: hashToken(token),
          shareExpiresAt: new Date(
            Date.now() + account.agency.shareDays * 86400_000,
          ),
          expiresAt: new Date(
            Date.now() + account.agency.retentionDays * 86400_000,
          ),
          quotaReleased: false,
          report,
        });
      } catch (err) {
        if (err instanceof QuotaError)
          return res.status(429).json({ error: err.message });
        throw err;
      }
      await identities.event(
        "report_created",
        account.agency.id,
        account.user.id,
        id,
      );
      try {
        await options.enqueue(id);
      } catch {
        await identities.event(
          "enqueue_deferred",
          account.agency.id,
          account.user.id,
          id,
        );
      }
      res.status(202).json({ id, sharePath: "/report/" + token });
    }),
  );
  app.get(
    "/api/reports/:id",
    wrap(async (req, res) => {
      const doc = await owned(req, res);
      if (!doc) return res.status(404).json({ error: "Report non trovato" });
      res.json(dto(doc));
    }),
  );
  app.get(
    "/api/reports/:id/assets/:file",
    wrap(async (req, res) => {
      const doc = await owned(req, res);
      if (!doc) return res.status(404).end();
      await asset(res, doc.report, req.params.file);
    }),
  );
  app.post(
    "/api/reports/:id/share",
    editor,
    wrap(async (req, res) => {
      if (!(await owned(req, res))) return res.status(404).end();
      const token = randomBytes(32).toString("base64url");
      await store.update(req.params.id, identity(res).agency.id, {
        shareHash: hashToken(token),
        shareExpiresAt: new Date(
          Date.now() + identity(res).agency.shareDays * 86400_000,
        ),
      });
      res.json({ sharePath: "/report/" + token });
    }),
  );
  app.delete(
    "/api/reports/:id/share",
    editor,
    wrap(async (req, res) => {
      if (!(await owned(req, res))) return res.status(404).end();
      await store.update(req.params.id, identity(res).agency.id, {
        shareHash: hashToken(randomBytes(32).toString("base64url")),
      });
      res.status(204).end();
    }),
  );
  app.patch(
    "/api/reports/:id/findings/:findingId",
    editor,
    wrap(async (req, res) => {
      const doc = await owned(req, res);
      if (!doc) return res.status(404).end();
      if (!isFinished(doc.report.status))
        return res
          .status(409)
          .json({ error: "Attendi la fine della scansione" });
      if (!["open", "resolved", "ignored"].includes(req.body?.status))
        return res.status(400).json({ error: "Stato non valido" });
      const finding = doc.report.findings.find(
        (f) => f.id === req.params.findingId,
      );
      if (!finding) return res.status(404).end();
      await store.triage(
        doc.id,
        identity(res).agency.id,
        finding.id,
        req.body.status,
      );
      await identities.event(
        "finding_updated",
        identity(res).agency.id,
        identity(res).user.id,
        doc.id,
      );
      res.json(dto((await owned(req, res))!));
    }),
  );
  app.delete(
    "/api/reports/:id",
    editor,
    wrap(async (req, res) => {
      const doc = await owned(req, res);
      if (!doc) return res.status(404).end();
      if (!isFinished(doc.report.status))
        return res.status(409).json({
          error: "Attendi la fine della scansione prima di eliminarla",
        });
      await store.requestDeletion(doc.id, identity(res).agency.id);
      await identities.event(
        "report_deleted",
        identity(res).agency.id,
        identity(res).user.id,
        doc.id,
      );
      res.status(202).json({ status: "deletion_pending" });
    }),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Endpoint non trovato" }),
  );
  if (options.webDir) {
    app.use(express.static(options.webDir, { index: false }));
    app.get("*", (_req, res) =>
      res.sendFile(path.join(options.webDir!, "index.html")),
    );
  }
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const badBody =
      err.type === "entity.too.large" || err instanceof SyntaxError;
    console.error("API failure:", err.name);
    res.status(badBody ? 400 : 500).json({
      error: badBody
        ? "Richiesta non valida o troppo grande"
        : "Errore interno. Riprova.",
    });
  });
  return app;
}
