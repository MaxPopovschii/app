import express from "express";
import helmet from "helmet";
import { timingSafeEqual } from "node:crypto";
import { SafeClient, safeRequest, digest } from "@launchcheck/shared";
export function createFetchApp(
  token: string,
  client: SafeClient = safeRequest,
) {
  if (token.length < 32) throw new Error("Fetch service key too short");
  const app = express();
  let active = 0;
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "8kb" }));
  app.get("/readyz", (_req, res) => res.json({ ready: true }));
  app.post("/fetch", async (req, res) => {
    if (
      !timingSafeEqual(
        Buffer.from(digest(req.get("Authorization") || "")),
        Buffer.from(digest("Bearer " + token)),
      )
    )
      return res.status(401).end();
    if (active >= 8)
      return res.status(503).json({ error: "Fetch service at capacity" });
    const { url, options = {} } = req.body || {};
    if (
      !options || typeof options !== "object" || Array.isArray(options) ||
      typeof url !== "string" ||
      url.length > 2048 ||
      !["GET", "HEAD", undefined].includes(options.method)
    )
      return res.status(400).json({ error: "Invalid request" });
    active++;
    try {
      const value = await client(url, {
        method: options.method || "GET",
        maxBytes: Math.min(
          5_000_000,
          Math.max(1, Number(options.maxBytes) || 5_000_000),
        ),
        timeoutMs: Math.min(
          10_000,
          Math.max(100, Number(options.timeoutMs) || 10_000),
        ),
        followRedirects: options.followRedirects !== false,
      });
      res.json({ ...value, body: value.body.toString("base64") });
    } catch {
      res
        .status(502)
        .json({ error: "Destination unavailable, blocked, or over budget" });
    } finally {
      active--;
    }
  });
  app.use((_err: any, _req: any, res: any, _next: any) =>
    res.status(400).json({ error: "Invalid request" }),
  );
  return app;
}
