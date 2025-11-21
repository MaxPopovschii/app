import { Router, Request, Response } from 'express';
import { checkDBHealth } from '../db';
import { checkRabbitHealth } from '../queue';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const dbHealthy = await checkDBHealth();
  const rabbitHealthy = await checkRabbitHealth();
  
  if (dbHealthy && rabbitHealthy) {
    res.json({ status: 'ok', services: { mongo: 'ok', rabbit: 'ok' } });
  } else {
    res.status(503).json({
      status: 'degraded',
      services: {
        mongo: dbHealthy ? 'ok' : 'error',
        rabbit: rabbitHealthy ? 'ok' : 'error'
      }
    });
  }
});

export { router as healthRouter };
