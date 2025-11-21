import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  const requestId = req.headers['x-request-id'] || 'unknown';
  console.error(`[${requestId}] Error:`, err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: 'internal_error',
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
}
