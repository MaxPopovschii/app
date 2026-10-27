import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import { chromium } from "playwright";
import { createApp } from "../api/src/app";
import { runAudit } from "../worker/dist/audit";
import {
  memoryStore,
  fixtureClient,
  memoryIdentity,
  testPassword,
} from "./helpers";

test(
  "agency creates a report, sees real evidence, shares read-only and revokes access",
  { timeout: 120_000 },
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "launchcheck-ui-"));
    const store = memoryStore(),
      jobs: Promise<any>[] = [],
      identity = await memoryIdentity();
    const options = {
      store,
      identities: identity.identities,
      authSecret: "ui-test-secret-with-at-least-32-characters",
      secureCookies: false,
      publicOrigin: "http://localhost",
      readiness: async () => ({ ready: true, checks: { worker: true } }),
      artifactDir: dir,
      webDir: path.resolve("web/dist"),
      enqueue: async (id: string) => {
        const doc = (await store.get(id, "a"))!;
        jobs.push(
          runAudit(doc.report, {
            artifactDir: dir,
            client: fixtureClient(),
            onProgress: async (report) => {
              store.values.get(id)!.report = structuredClone(report);
            },
          }),
        );
      },
    };
    const app = createApp(options);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as any,
      origin = `http://127.0.0.1:${address.port}`;
    options.publicOrigin = origin;
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1050 },
      });
      await page.goto(origin);
      await page.getByLabel("Email").fill("owner@example.com");
      await page.getByLabel("Password", { exact: true }).fill(testPassword);
      await page.getByRole("button", { name: "Entra nel workspace →" }).click();
      await page
        .getByRole("button", { name: "Crea il primo report →" })
        .click();
      await page
        .getByLabel("Sito del cliente")
        .fill("https://fixture.example/");
      await page
        .getByLabel("Nome cliente")
        .fill("Aurora Studio · esempio di test");
      assert.equal(
        await page.getByLabel("La tua agenzia").inputValue(),
        "Studio Forma",
      );
      await page.getByLabel("Pagine da verificare").selectOption("1");
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Avvia la verifica →" }).click();
      await page
        .getByRole("button", { name: "Stampa / PDF" })
        .waitFor({ timeout: 40_000 });
      await page
        .getByRole("button", { name: /Immagine non caricata/ })
        .first()
        .waitFor();
      await page
        .getByRole("button", {
          name: /Contenuto oltre la larghezza dello schermo/,
        })
        .first()
        .click();
      await page.locator(".evidence-panel img").first().waitFor();
      await mkdir("test-results", { recursive: true });
      await page.screenshot({
        path: "test-results/report-desktop.png",
        fullPage: true,
      });
      // A second browser context has no agency session and must still be able to read the report.
      const shareHref = await page
        .getByRole("link", { name: "Apri report condiviso ↗" })
        .getAttribute("href");
      assert.ok(shareHref);
      const visitor = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const sharedPage = await visitor.newPage();
      await sharedPage.goto(shareHref!);
      await sharedPage
        .getByRole("heading", { name: "Aurora Studio · esempio di test" })
        .waitFor();
      assert.equal(
        await sharedPage
          .getByRole("button", { name: "Nuova verifica" })
          .count(),
        0,
      );
      assert.equal(
        await sharedPage.getByRole("combobox", { name: /Stato:/ }).count(),
        0,
      );
      const overflow = await sharedPage.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      assert.equal(overflow, false);
      await sharedPage.screenshot({
        path: "test-results/report-mobile.png",
        fullPage: true,
      });
      await sharedPage.emulateMedia({ media: "print" });
      await sharedPage.locator(".print-only img").first().waitFor();
      await sharedPage.waitForFunction(() =>
        Array.from(document.images).every((img) => img.complete),
      );
      await sharedPage.pdf({
        path: "test-results/report-print.pdf",
        format: "A4",
        printBackground: true,
      });
      await page.getByRole("button", { name: "Revoca link" }).click();
      const response = await sharedPage.request.get(
        shareHref!.replace("/report/", "/api/share/"),
      );
      assert.equal(response.status(), 404);
      await visitor.close();
      await page.getByRole("button", { name: "Tutti i report" }).click();
      await page
        .getByRole("heading", { name: "Ogni consegna, sotto controllo." })
        .waitFor();
      await page.screenshot({
        path: "test-results/dashboard.png",
        fullPage: true,
      });
    } finally {
      await Promise.all(jobs);
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  },
);
