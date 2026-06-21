import winston from 'winston';

const { combine, timestamp, printf, colorize, errors } = winston.format;

const fmt = printf(({ level, message, timestamp: ts, stack }) =>
  `${ts} [wings] [${level}]: ${stack || message}`
);

export const logger = winston.createLogger({
  level: process.env.DEBUG === 'true' ? 'debug' : 'info',
  format: combine(
    colorize(),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    fmt
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: '/var/log/mc-wings/error.log', level: 'error' }),
    new winston.transports.File({ filename: '/var/log/mc-wings/wings.log' }),
  ],
  exceptionHandlers: [
    new winston.transports.Console(),
  ],
});

// Create log dir if it doesn't exist
import fs from 'fs';
try {
  fs.mkdirSync('/var/log/mc-wings', { recursive: true });
} catch { /* ignore */ }
