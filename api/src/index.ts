import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { connectDB } from './db';
import { connectRabbit } from './queue';
import { crawlRouter } from './routes/crawl';
import { healthRouter } from './routes/health';
import { errorHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';

const PORT = process.env.PORT || 8080;

async function startServer() {
  const app = express();

  // Middleware
  app.use(requestId);
  app.use(morgan(':method :url :status :response-time ms - :req[x-request-id]'));
  app.use(helmet({
    contentSecurityPolicy: false, // Allow serving static content
  }));
  app.use(cors());
  app.use(express.json());

  // Serve static files from public/
  app.use(express.static(path.join(__dirname, '../public')));

  // Routes
  app.use('/crawl', crawlRouter);
  app.use('/healthz', healthRouter);

  // SPA fallback - serve index.html for all other routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  // Error handling
  app.use(errorHandler);

  // Connect to services
  await connectDB();
  await connectRabbit();

  app.listen(PORT, () => {
    console.log(`API server listening on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
