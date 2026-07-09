import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { AuthRequest } from '../types';

// Augment Express's Request so `req.id` is typed everywhere without a cast.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
      startTime?: number;
    }
  }
}

// Frequently-polled infra endpoints — logging every hit drowns real request
// traffic in noise (a load balancer may hit /health/ready every few seconds).
const SKIP_LOG = new Set(['/health', '/health/ready']);

// Assigns each request a correlation id and logs one structured line when it
// finishes: id, method, path, status, duration, and (when authenticated) the
// acting user. The id is echoed back in the X-Request-Id response header so a
// user reporting a problem can quote it and an operator can grep the logs for
// that exact request. Honors an inbound X-Request-Id so the id survives across
// a reverse proxy / multi-hop call chain instead of being regenerated.
export function requestContext(req: Request, res: Response, next: NextFunction) {
  const inbound = req.header('X-Request-Id');
  // Only trust an inbound id that looks sane, so a client can't inject newlines
  // or huge strings into our log lines via this header.
  req.id = inbound && /^[\w-]{1,64}$/.test(inbound) ? inbound : crypto.randomUUID().slice(0, 8);
  req.startTime = Date.now();
  res.setHeader('X-Request-Id', req.id);

  res.on('finish', () => {
    if (SKIP_LOG.has(req.path)) return;
    const ms = Date.now() - (req.startTime || Date.now());
    const userId = (req as AuthRequest).user?.id;
    const line = `req=${req.id} ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms}ms${userId ? ` user=${userId}` : ''}`;
    // Route by outcome so error/warn transports capture failing requests: 5xx
    // is a server fault, 4xx is a client one, everything else is normal http.
    if (res.statusCode >= 500) logger.error(line);
    else if (res.statusCode >= 400) logger.warn(line);
    else logger.http(line);
  });

  next();
}
