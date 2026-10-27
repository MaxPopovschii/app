import { chromium, BrowserContext } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import robotsParser from "robots-parser";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import {
  AuditReport,
  Finding,
  PageResult,
  VIEWPORTS,
  SafeClient,
  safeRequest,
  normalizeTarget,
  fingerprint,
  compareWithBaseline,
} from "@launchcheck/shared";

interface AuditOptions {
  artifactDir: string;
  client?: SafeClient;
  baseline?: AuditReport;
  onProgress?: (report: AuditReport) => Promise<void>;
}
export async function runAudit(
  report: AuditReport,
  options: AuditOptions,
): Promise<AuditReport> {
  const client = options.client || safeRequest;
  const origin = normalizeTarget(report.url).origin;
  const urls = [report.url],
    seen = new Set(urls);
  const dir = path.join(options.artifactDir, report.id);
  await mkdir(dir, { recursive: true });
  report.status = "running";
  report.pages = [];
  report.findings = [];
  report.resolvedSinceBaseline = [];
  report.notes = [
    "Controlli di sola lettura su pagine pubbliche. Moduli, login e acquisti non vengono eseguiti.",
    "Le variazioni visive sono da verificare: non dimostrano da sole un errore. Nessuna valutazione AI è presentata come problema confermato.",
  ];
  const publish = async () => {
    report.updatedAt = new Date().toISOString();
    await options.onProgress?.(structuredClone(report));
  };
  const add = (
    page: PageResult,
    data: Omit<
      Finding,
      "id" | "fingerprint" | "url" | "viewport" | "status" | "change"
    >,
  ) => {
    const fp = fingerprint(
      data.kind,
      page.url,
      page.viewport,
      data.selector || data.detail,
    );
    if (report.findings.some((f) => f.fingerprint === fp)) return;
    if (report.findings.length >= 300) {
      if (!report.notes.includes("Limite di 300 segnalazioni raggiunto."))
        report.notes.push("Limite di 300 segnalazioni raggiunto.");
      return;
    }
    report.findings.push({
      ...data,
      id: fp,
      fingerprint: fp,
      url: page.url,
      viewport: page.viewport,
      status: "open",
      change: "new",
      evidence: page.screenshot,
    });
  };
  const robotCache = new Map<string, ReturnType<typeof robotsParser> | null>();
  const mayScan = async (url: string) => {
    const host = new URL(url).origin;
    if (!robotCache.has(host)) {
      const response = await client(host + "/robots.txt", {
        maxBytes: 256_000,
        timeoutMs: 5000,
      });
      if ([401, 403].includes(response.status) || response.status >= 500)
        throw new Error("robots.txt non verificabile: scansione interrotta");
      robotCache.set(
        host,
        response.status >= 400
          ? null
          : robotsParser(host + "/robots.txt", response.body.toString("utf8")),
      );
    }
    return robotCache.get(host)?.isAllowed(url, "LaunchCheck") !== false;
  };
  const linkCache = new Map<string, number>();
  let browser;
  try {
    await publish();
    browser = await chromium.launch({
      headless: true,
      proxy: { server: "http://127.0.0.1:9", bypass: "<-loopback>" },
      args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
    });
    for (
      let index = 0;
      index < urls.length && index < report.maxPages;
      index++
    ) {
      const url = urls[index];
      report.totalPages = Math.min(urls.length, report.maxPages);
      for (const viewport of VIEWPORTS) {
        const started = Date.now();
        const record: PageResult = {
          url,
          viewport: viewport.name,
          status: "failed",
          durationMs: 0,
        };
        let context: BrowserContext | undefined;
        let expired = false;
        let closed = false;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          if (!(await mayScan(url))) {
            record.status = "blocked";
            record.error = "Scansione esclusa da robots.txt";
            continue;
          }
          context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            serviceWorkers: "block",
            acceptDownloads: false,
            userAgent: "LaunchCheck/0.1 (+authorized-website-audits)",
            reducedMotion: "reduce",
          });
          await context.addInitScript(() => {
            for (const key of ["RTCPeerConnection", "webkitRTCPeerConnection"])
              Object.defineProperty(globalThis, key, {
                value: undefined,
                configurable: false,
                writable: false,
              });
          });
          context.on("close", () => {
            closed = true;
          });
          deadline = setTimeout(() => {
            expired = true;
            context?.close().catch(() => {});
          }, 40_000);
          await context.routeWebSocket("**/*", (ws) => ws.close());
          let requests = 0,
            bytes = 0,
            limited = false,
            blocked = 0,
            active = 0;
          const waiters: (() => void)[] = [];
          const acquire = async () => {
            if (active >= 6)
              await new Promise<void>((resolve) => waiters.push(resolve));
            active++;
          };
          const release = () => {
            active--;
            waiters.shift()?.();
          };
          // Every outbound request is fetched by the DNS-pinned safe client. Never route.continue().
          await context.route("**/*", async (route) => {
            const request = route.request();
            if (
              !["GET", "HEAD"].includes(request.method()) ||
              ["media"].includes(request.resourceType())
            ) {
              blocked++;
              await route.abort();
              return;
            }
            if (++requests > 180 || bytes > 15_000_000) {
              limited = true;
              await route.abort();
              return;
            }
            await acquire();
            try {
              if (closed || expired) {
                await route.abort().catch(() => {});
                return;
              }
              normalizeTarget(request.url());
              if (
                request.isNavigationRequest() &&
                new URL(request.url()).origin !== origin
              )
                throw new Error("Redirect fuori dal sito autorizzato");
              if (
                request.isNavigationRequest() &&
                !(await mayScan(request.url()))
              )
                throw new Error("Escluso da robots.txt");
              const response = await client(request.url(), {
                followRedirects: false,
                maxBytes: 5_000_000,
                method: request.method() as "GET" | "HEAD",
              });
              bytes += response.body.length;
              if (bytes > 15_000_000) {
                limited = true;
                await route.abort();
                return;
              }
              // Fulfill redirects unchanged: the next hop is intercepted and validated again.
              await route.fulfill({
                status: response.status,
                headers: response.headers,
                body: response.body,
              });
            } catch {
              blocked++;
              await route.abort().catch(() => {});
            } finally {
              release();
            }
          });
          const page = await context.newPage();
          const jsErrors = new Set<string>();
          page.on("pageerror", (err) => {
            if (jsErrors.size < 10) jsErrors.add(err.message.slice(0, 300));
          });
          const response = await page.goto(url, {
            waitUntil: "load",
            timeout: 25_000,
          });
          await page.waitForTimeout(500);
          record.httpStatus = response?.status();
          record.screenshot = `${index}-${viewport.name}.png`;
          await page.screenshot({
            path: path.join(dir, record.screenshot),
            fullPage: false,
            animations: "disabled",
            timeout: 8000,
          });
          if (response && response.status() >= 400)
            add(record, {
              kind: "http-error",
              severity: "high",
              source: "automated",
              title: "La pagina restituisce un errore HTTP",
              detail: `HTTP ${response.status()}`,
              recommendation:
                "Correggere la risposta del server o aggiornare il collegamento alla pagina.",
            });
          const observations = await page.evaluate(() => {
            const visible = (el: Element) => {
              const s = getComputedStyle(el);
              const r = el.getBoundingClientRect();
              return (
                s.display !== "none" &&
                s.visibility !== "hidden" &&
                s.opacity !== "0" &&
                r.width > 0 &&
                r.height > 0 &&
                !el.closest('[hidden], [aria-hidden="true"]')
              );
            };
            const selector = (el: Element) => {
              if (el.id) return "#" + CSS.escape(el.id);
              const parts: string[] = [];
              for (
                let e: Element | null = el;
                e && parts.length < 4;
                e = e.parentElement
              ) {
                const siblings: Element[] = e.parentElement
                  ? Array.from(e.parentElement.children).filter(
                      (s) => s.tagName === e!.tagName,
                    )
                  : [e];
                parts.unshift(
                  e.tagName.toLowerCase() +
                    ":nth-of-type(" +
                    (siblings.indexOf(e) + 1) +
                    ")",
                );
              }
              return parts.join(" > ");
            };
            return {
              brokenImages: Array.from(document.images)
                .filter(
                  (el) => visible(el) && el.complete && el.naturalWidth === 0,
                )
                .slice(0, 20)
                .map((el) => ({
                  selector: selector(el),
                  src: el.getAttribute("src")?.slice(0, 200) || "",
                })),
              overflow: Array.from(
                document.querySelectorAll(
                  "main *, article *, section *, header *, footer *, body > *",
                ),
              )
                .filter((el) => {
                  const r = el.getBoundingClientRect();
                  return (
                    visible(el) &&
                    r.right > innerWidth + 4 &&
                    r.left >= 0 &&
                    r.width > 20 &&
                    getComputedStyle(el).position !== "fixed"
                  );
                })
                .slice(0, 10)
                .map((el) => ({
                  selector: selector(el),
                  pixels: Math.round(
                    el.getBoundingClientRect().right - innerWidth,
                  ),
                })),
              links: Array.from(document.querySelectorAll("a[href]"))
                .map((el) => (el as HTMLAnchorElement).href)
                .slice(0, 200),
            };
          });
          for (const image of observations.brokenImages)
            add(record, {
              kind: "broken-image",
              severity: "medium",
              source: "automated",
              title: "Immagine non caricata",
              detail: image.src,
              selector: image.selector,
              recommendation:
                "Verificare percorso, risposta HTTP e formato dell’immagine.",
            });
          for (const element of observations.overflow)
            add(record, {
              kind: "horizontal-overflow",
              severity: "medium",
              source: "automated",
              title: "Contenuto oltre la larghezza dello schermo",
              detail: `Il bordo destro supera il viewport di ${element.pixels} px. Verificare se lo scorrimento è intenzionale.`,
              selector: element.selector,
              recommendation:
                "Verificare le larghezze fisse e riprodurre il comportamento al viewport indicato.",
            });
          for (const error of jsErrors)
            add(record, {
              kind: "javascript-error",
              severity: "medium",
              source: "automated",
              title: "Eccezione JavaScript non gestita",
              detail: error,
              recommendation:
                "Riprodurre l’errore nella console e correggere lo script interessato.",
            });
          const internalLinks = [...new Set(observations.links)].flatMap(
            (href) => {
              try {
                const target = normalizeTarget(href);
                if (
                  target.origin !== origin ||
                  /\.(pdf|zip|png|jpe?g|gif|svg|mp4|webp)$/i.test(
                    target.pathname,
                  )
                )
                  return [];
                return [target.href];
              } catch {
                return [];
              }
            },
          );
          for (const href of internalLinks) {
            if (expired) throw new Error("Tempo massimo della vista superato");
            if (!seen.has(href) && urls.length < report.maxPages) {
              seen.add(href);
              urls.push(href);
            }
            if (linkCache.size >= 40 && !linkCache.has(href)) {
              report.notes.push(
                "Controllo collegamenti limitato a 40 destinazioni interne per audit.",
              );
              continue;
            }
            if (!linkCache.has(href)) {
              try {
                if (!(await mayScan(href))) continue;
                let result = await client(href, {
                  method: "HEAD",
                  maxBytes: 128_000,
                });
                if (result.status === 405)
                  result = await client(href, { maxBytes: 256_000 });
                linkCache.set(href, result.status);
              } catch {
                linkCache.set(href, 0);
              }
            }
            const status = linkCache.get(href)!;
            if (status >= 400 && ![401, 403, 429].includes(status))
              add(record, {
                kind: "broken-link",
                severity: "high",
                source: "automated",
                title: "Collegamento interno non funzionante",
                detail: `HTTP ${status}: ${href}`,
                selector: href,
                recommendation:
                  "Ripristinare la destinazione o correggere il link.",
              });
          }
          const baselinePage = options.baseline?.pages.find(
            (p) =>
              p.url === url &&
              p.viewport === viewport.name &&
              p.status === "done",
          );
          if (baselinePage?.screenshot) {
            try {
              const previous = PNG.sync.read(
                await readFile(
                  path.join(
                    options.artifactDir,
                    options.baseline!.id,
                    baselinePage.screenshot,
                  ),
                ),
              );
              const current = PNG.sync.read(
                await readFile(path.join(dir, record.screenshot)),
              );
              if (
                previous.width === current.width &&
                previous.height === current.height
              ) {
                const diff = new PNG({
                  width: current.width,
                  height: current.height,
                });
                const pixels = pixelmatch(
                  previous.data,
                  current.data,
                  diff.data,
                  current.width,
                  current.height,
                  { threshold: 0.15, includeAA: false },
                );
                record.changedPixelsPercent =
                  Math.round(
                    (pixels / (current.width * current.height)) * 10000,
                  ) / 100;
                if (record.changedPixelsPercent >= 1) {
                  record.diffScreenshot = `${index}-${viewport.name}-diff.png`;
                  await writeFile(
                    path.join(dir, record.diffScreenshot),
                    PNG.sync.write(diff),
                  );
                  add(record, {
                    kind: "visual-change",
                    severity: "low",
                    source: "visual-comparison",
                    title: "Variazione visiva da verificare",
                    detail: `${record.changedPixelsPercent}% dei pixel è cambiato rispetto alla baseline. Contenuti dinamici e modifiche volute possono produrre questa segnalazione.`,
                    recommendation:
                      "Confrontare screenshot e differenza evidenziata prima di decidere se intervenire.",
                  });
                }
              } else
                report.notes.push(
                  "Confronto visivo saltato: dimensioni degli screenshot differenti.",
                );
            } catch {
              report.notes.push(
                "Una prova della baseline non è disponibile: confronto visivo saltato.",
              );
            }
          }
          if (expired) throw new Error("Tempo massimo della vista superato");
          record.status = limited ? "failed" : "done";
          record.comparisonEligible =
            !limited && blocked === 0 && (record.httpStatus ?? 200) < 400;
          if (limited)
            record.error =
              "Limite di risorse raggiunto: acquisizione incompleta";
          if (blocked)
            report.notes.push(
              `${url} (${viewport.name}): ${blocked} richieste non ammesse o non disponibili; i risultati possono essere incompleti.`,
            );
        } catch (err: any) {
          record.error = err.message.slice(0, 250);
        } finally {
          if (deadline) clearTimeout(deadline);
          await context?.close();
          record.durationMs = Date.now() - started;
          report.pages.push(record);
          report.scannedPages = report.pages.filter(
            (p) => p.status === "done",
          ).length;
          report.totalPages = Math.min(urls.length, report.maxPages) * 2;
          await publish();
        }
      }
    }
    const successful = report.pages.filter((p) => p.status === "done").length;
    report.status =
      successful === report.pages.length
        ? "complete"
        : successful
          ? "partial"
          : "failed";
    compareWithBaseline(report, options.baseline);
  } catch (err: any) {
    report.status = "failed";
    report.error = err.message.slice(0, 250);
  } finally {
    await browser?.close();
    report.completedAt = new Date().toISOString();
    report.notes = [...new Set(report.notes)];
    await publish();
  }
  return report;
}
