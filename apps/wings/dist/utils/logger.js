"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
const { combine, timestamp, printf, colorize, errors } = winston_1.default.format;
const fmt = printf(({ level, message, timestamp: ts, stack }) => `${ts} [wings] [${level}]: ${stack || message}`);
exports.logger = winston_1.default.createLogger({
    level: process.env.DEBUG === 'true' ? 'debug' : 'info',
    format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true }), fmt),
    transports: [
        new winston_1.default.transports.Console(),
        new winston_1.default.transports.File({ filename: '/var/log/mc-wings/error.log', level: 'error' }),
        new winston_1.default.transports.File({ filename: '/var/log/mc-wings/wings.log' }),
    ],
    exceptionHandlers: [
        new winston_1.default.transports.Console(),
    ],
});
// Create log dir if it doesn't exist
const fs_1 = __importDefault(require("fs"));
try {
    fs_1.default.mkdirSync('/var/log/mc-wings', { recursive: true });
}
catch { /* ignore */ }
//# sourceMappingURL=logger.js.map