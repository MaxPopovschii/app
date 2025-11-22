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
      let context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (compatible; WebAnalyzer/1.0)'
      });
      
      let page = await context.newPage();
      page.setDefaultTimeout(30000);
      
      const viewport = { w: 1920, h: 1080 };
      const userAgent = 'Mozilla/5.0 (compatible; WebAnalyzer/1.0)';
      
      try {
        // Vai alla pagina con strategia multipla e gestione HTTP/2
        let lastError;
        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        } catch (e: any) {
          lastError = e;
          // Se errore HTTP/2, riprova senza HTTP/2
          if (e.message && e.message.includes('ERR_HTTP2_PROTOCOL_ERROR')) {
            await context.close();
            const newContext = await browser.newContext({
              viewport: { width: 1920, height: 1080 },
              userAgent: 'Mozilla/5.0 (compatible; WebAnalyzer/1.0)',
              ignoreHTTPSErrors: true
            });
            const newPage = await newContext.newPage();
            newPage.setDefaultTimeout(30000);
            
            try {
              await newPage.goto(url, { waitUntil: 'load', timeout: 30000 });
              // Se funziona, usiamo la nuova pagina
              await context.close();
              page = newPage;
              context = newContext;
            } catch {
              await newContext.close();
              throw lastError;
            }
          } else {
            try {
              await page.goto(url, { waitUntil: 'load', timeout: 30000 });
            } catch {
              await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            }
          }
        }
        
        // Aspetta molto tempo che tutto si carichi completamente
        await page.waitForTimeout(5000);
        
        // Aspetta che le risorse di rete si stabilizzino
        await page.waitForLoadState('networkidle').catch(() => {});
        
        // Scroll della pagina per attivare lazy loading
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight / 2)');
        await page.waitForTimeout(3000);
        await page.evaluate('window.scrollTo(0, 0)');
        await page.waitForTimeout(3000);
        
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
        if (msg.includes('ERR_HTTP2_PROTOCOL_ERROR')) msg = 'Errore di connessione HTTP/2';
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
