import { chromium } from 'playwright';
import { Page } from './models/Page';
import { checkRobotsTxt } from './robots';
import { analyzeScreenshot } from './openai';

export async function processCrawl(uid: string, url: string): Promise<void> {
  const start = Date.now();
  
  try {
    // Controlla se il sito permette il crawling
    const allowed = await checkRobotsTxt(url);
    if (!allowed) {
      await Page.updateOne({ uid }, {
        status: 'error',
        errorMessage: 'Sito protetto da robots.txt',
        tookMs: Date.now() - start,
        updatedAt: new Date()
      });
      return;
    }
    
    // Apri il browser
    const browser = await chromium.launch({ headless: true });
    
    try {
      const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (compatible; WebAnalyzer/1.0)'
      });
      
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      
      const viewport = { w: 1920, h: 1080 };
      const userAgent = 'Mozilla/5.0 (compatible; WebAnalyzer/1.0)';
      
      try {
        // Vai alla pagina
        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });
        } catch {
          await page.goto(url, { waitUntil: 'domcontentloaded' });
        }
        
        // Fai lo screenshot
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 50, fullPage: true });
        
        // Analizza con AI
        const description = await analyzeScreenshot(screenshot);
        
        // Salva risultato con meta
        await Page.updateOne({ uid }, {
          status: 'done',
          description,
          image: screenshot,
          url: page.url(),
          tookMs: Date.now() - start,
          updatedAt: new Date(),
          meta: {
            viewport,
            userAgent,
            timestamp: new Date()
          }
        });
      } catch (error: any) {
        let msg = error.message || 'Errore sconosciuto';
        
        if (msg.includes('ERR_CERT')) msg = 'Certificato SSL non valido';
        if (msg.includes('401') || msg.includes('auth')) msg = 'Richiede autenticazione';
        if (msg.includes('timeout')) msg = 'Timeout: il sito impiega troppo tempo';
        
        await Page.updateOne({ uid }, {
          status: 'error',
          errorMessage: msg,
          tookMs: Date.now() - start,
          updatedAt: new Date()
        });
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  } catch (error: any) {
    await Page.updateOne({ uid }, {
      status: 'error',
      errorMessage: error.message || 'Errore durante elaborazione',
      tookMs: Date.now() - start,
      updatedAt: new Date()
    });
    throw error;
  }
}
