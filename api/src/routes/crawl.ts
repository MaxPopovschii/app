import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { ulid } from 'ulid';
import { Page } from '../models/Page';
import { publishCrawlRequest } from '../queue';

const router = Router();

// Limite: massimo 10 richieste al minuto
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Troppi tentativi, aspetta un minuto!' }
});

router.use(limiter);

// Controlla se l'URL è valido
function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Richiesta di analisi di un sito
router.post('/', async (req: Request, res: Response) => {
  const { url } = req.body;
  
  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'URL non valido' });
  }
  
  try {
    // Controlla se stiamo già analizzando questo URL
    const existing = await Page.findOne({
      url,
      status: 'pending',
      createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
    });
    
    if (existing) {
      return res.status(202).json({ uid: existing.uid });
    }
    
    // Crea nuova richiesta
    const uid = ulid();
    
    await Page.create({
      uid,
      url,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    // Invia al worker
    await publishCrawlRequest({ uid, url, requestedAt: new Date().toISOString() });
    
    res.status(202).json({ uid });
  } catch (error) {
    console.error('Errore:', error);
    res.status(500).json({ error: 'Qualcosa è andato storto' });
  }
});

// Controlla lo stato dell'analisi
router.get('/:uid', async (req: Request, res: Response) => {
  const { uid } = req.params;
  
  try {
    const page = await Page.findOne({ uid });
    
    if (!page) {
      return res.status(404).json({ error: 'Non trovato' });
    }
    
    if (page.status === 'pending') {
      return res.json({ status: 'pending' });
    }
    
    if (page.status === 'error') {
      return res.json({ status: 'error', message: page.errorMessage || 'Errore sconosciuto' });
    }
    
    // Analisi completata
    const image = page.image ? `data:image/jpeg;base64,${page.image.toString('base64')}` : '';
    
    return res.json({
      status: 'done',
      result: {
        url: page.url,
        description: page.description || '',
        image,
        tookMs: page.tookMs || 0
      }
    });
  } catch (error) {
    console.error('Errore:', error);
    res.status(500).json({ error: 'Errore interno' });
  }
});

export { router as crawlRouter };
