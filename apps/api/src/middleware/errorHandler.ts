import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  // Tie the stack trace to the same correlation id the requestContext logger
  // and the X-Request-Id response header use, so a client-reported failure
  // can be matched to its exact stack in the logs.
  const reqId = req.id ? `req=${req.id} ` : '';
  logger.error(`${reqId}${err.message}`, { stack: err.stack });

  if (err.name === 'ValidationError') {
    return res.status(422).json({ message: err.message });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ message: 'Invalid token' });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ message: 'Token expired' });
  }

  res.status(500).json({
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    // Surface the id to the client on a 500 so a user can quote it in a bug
    // report — it's an opaque correlation token, not sensitive.
    requestId: req.id,
  });
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ message: 'Route not found' });
}
