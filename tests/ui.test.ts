import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import { chromium } from 'playwright';
import { createApp } from '../api/src/app';
import { runAudit } from '../worker/src/audit';
import { memoryStore, fixtureClient } from './helpers';

test('agency creates a report, sees real evidence, shares read-only and revokes access', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'launchcheck-ui-'));
  const store = memoryStore(), jobs: Promise<any>[] = [], key = 'ui-test-agency-access-key-32-characters';
  const app = createApp({ store, adminToken: key, artifactDir: dir, webDir: path.resolve('web/dist'), enqueue: async id => {
    const doc = (await store.get(id))!;
    jobs.push(runAudit(doc.report, { artifactDir: dir, client: fixtureClient(), onProgress: report => store.update(id, { report }) }));
  } });
  const server = app.listen(0,'127.0.0.1'); await new Promise<void>(resolve => server.once('listening',resolve));
  const address = server.address() as any, origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    await page.goto(origin);
    await page.getByLabel('Chiave di accesso agenzia').fill(key);
    await page.getByRole('button',{ name:'Entra nel workspace →' }).click();
    await page.getByRole('button',{ name:'Crea il primo report →' }).click();
    await page.getByLabel('Sito del cliente').fill('https://fixture.example/');
    await page.getByLabel('Nome cliente').fill('Aurora Studio · esempio di test');
    await page.getByLabel('La tua agenzia').fill('Studio Forma');
    await page.getByLabel('Pagine da verificare').selectOption('1');
    await page.getByRole('checkbox').check();
    await page.getByRole('button',{ name:'Avvia la verifica →' }).click();
    await page.getByRole('button',{ name:'Stampa / PDF' }).waitFor({ timeout: 40_000 });
    assert.ok(await page.getByText('Immagine non caricata',{ exact:true }).count() > 0);
    await page.getByRole('button',{ name:'Contenuto oltre la larghezza dello schermo ↗' }).first().click();
    await page.locator('.evidence-panel img').first().waitFor();
    await mkdir('test-results',{ recursive:true });
    await page.screenshot({ path:'test-results/report-desktop.png', fullPage:true });
    // A second browser context has no agency session and must still be able to read the report.
    const shareHref = await page.getByRole('link',{ name:'Apri report condiviso ↗' }).getAttribute('href');
    assert.ok(shareHref);
    const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const sharedPage = await visitor.newPage(); await sharedPage.goto(shareHref!);
    await sharedPage.getByRole('heading',{ name:'Aurora Studio · esempio di test' }).waitFor();
    assert.equal(await sharedPage.getByRole('button',{ name:'Nuova verifica' }).count(),0);
    assert.equal(await sharedPage.getByRole('combobox',{ name:/Stato:/ }).count(),0);
    const overflow = await sharedPage.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(overflow,false);
    await sharedPage.screenshot({ path:'test-results/report-mobile.png', fullPage:true });
    await sharedPage.emulateMedia({ media:'print' });
    await sharedPage.pdf({ path:'test-results/report-print.pdf', format:'A4', printBackground:true });
    await page.getByRole('button',{ name:'Revoca link' }).click();
    const response = await sharedPage.request.get(shareHref!.replace('/report/','/api/share/')); assert.equal(response.status(),404);
    await visitor.close();
    await page.getByRole('button',{ name:'Tutti i report' }).click();
    await page.getByRole('heading',{ name:'Ogni consegna, sotto controllo.' }).waitFor();
    await page.screenshot({ path:'test-results/dashboard.png', fullPage:true });
  } finally { await Promise.all(jobs); await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir,{ recursive:true,force:true }); }
});
