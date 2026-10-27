import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import {
  AuditReport,
  ReportStore,
  normalizeTarget,
  isFinished,
} from "@launchcheck/shared";
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const wrap =
  (fn: (req: Request, res: Response) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
export interface AppOptions {
  store: ReportStore;
  adminToken: string;
  enqueue: (id: string) => Promise<void>;
  artifactDir: string;
  webDir?: string;
}
export function createApp(options: AppOptions) {
  if (options.adminToken.length < 32)
    throw new Error("ADMIN_TOKEN deve contenere almeno 32 caratteri");
  const { store } = options;
  const app = express();
  app.disable("x-powered-by");
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
  const authorize = (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.replace(/^Bearer /, "") || "";
    if (
      !timingSafeEqual(
        Buffer.from(hashToken(token)),
        Buffer.from(hashToken(options.adminToken)),
      )
    )
      return res.status(401).json({ error: "Accesso agenzia richiesto" });
    next();
  };
  const publicReport = (report: AuditReport) => ({
    ...report,
    error: report.error
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
      res.json(publicReport(doc.report));
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
  app.use("/api/reports", authorize);
  app.get(
    "/api/reports",
    wrap(async (_req, res) => {
      res.json(
        (await store.list()).map(
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
      let target: URL;
      try {
        target = normalizeTarget(typeof url === "string" ? url : "");
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }
      if (authorized !== true)
        return res
          .status(400)
          .json({
            error: "Conferma di essere autorizzato a verificare il sito",
          });
      if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10)
        return res.status(400).json({ error: "Scegli da 1 a 10 pagine" });
      if (
        ![agency, client].every(
          (v) =>
            typeof v === "string" && v.trim().length > 0 && v.length <= 100,
        )
      )
        return res
          .status(400)
          .json({
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
        const baseline = (await store.get(baselineId))?.report;
        if (
          !baseline ||
          !["complete", "partial"].includes(baseline.status) ||
          new URL(baseline.url).origin !== target.origin
        )
          return res
            .status(400)
            .json({
              error:
                "La baseline deve essere una scansione conclusa dello stesso sito",
            });
      }
      if ((await store.list()).filter((r) => !isFinished(r.status)).length >= 3)
        return res
          .status(429)
          .json({
            error: "Tre scansioni sono già in coda. Attendi il completamento.",
          });
      const id = randomUUID(),
        token = randomBytes(32).toString("base64url"),
        now = new Date().toISOString();
      const report: AuditReport = {
        id,
        url: target.href,
        agency: agency.trim(),
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
      await store.create({ id, shareHash: hashToken(token), report });
      try {
        await options.enqueue(id);
      } catch {
        report.status = "failed";
        report.error = "Coda temporaneamente non disponibile";
        await store.update(id, { report });
        return res.status(503).json({ error: report.error });
      }
      res.status(202).json({ id, sharePath: "/report/" + token });
    }),
  );
  app.get(
    "/api/reports/:id",
    wrap(async (req, res) => {
      const doc = await store.get(req.params.id);
      if (!doc) return res.status(404).json({ error: "Report non trovato" });
      res.json(doc.report);
    }),
  );
  app.get(
    "/api/reports/:id/assets/:file",
    wrap(async (req, res) => {
      const doc = await store.get(req.params.id);
      if (!doc) return res.status(404).end();
      await asset(res, doc.report, req.params.file);
    }),
  );
  app.post(
    "/api/reports/:id/share",
    wrap(async (req, res) => {
      if (!(await store.get(req.params.id))) return res.status(404).end();
      const token = randomBytes(32).toString("base64url");
      await store.update(req.params.id, { shareHash: hashToken(token) });
      res.json({ sharePath: "/report/" + token });
    }),
  );
  app.delete(
    "/api/reports/:id/share",
    wrap(async (req, res) => {
      if (!(await store.get(req.params.id))) return res.status(404).end();
      await store.update(req.params.id, {
        shareHash: hashToken(randomBytes(32).toString("base64url")),
      });
      res.status(204).end();
    }),
  );
  app.patch(
    "/api/reports/:id/findings/:findingId",
    wrap(async (req, res) => {
      const doc = await store.get(req.params.id);
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
      finding.status = req.body?.status;
      doc.report.updatedAt = new Date().toISOString();
      await store.update(doc.id, { report: doc.report });
      res.json(doc.report);
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
    res
      .status(badBody ? 400 : 500)
      .json({
        error: badBody
          ? "Richiesta non valida o troppo grande"
          : "Errore interno. Riprova.",
      });
  });
  return app;
}
