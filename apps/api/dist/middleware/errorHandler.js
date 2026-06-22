"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
exports.notFound = notFound;
const logger_1 = require("../utils/logger");
function errorHandler(err, _req, res, _next) {
    logger_1.logger.error(err.message, { stack: err.stack });
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
    });
}
function notFound(_req, res) {
    res.status(404).json({ message: 'Route not found' });
}
//# sourceMappingURL=errorHandler.js.map