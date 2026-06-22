"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = exports.app = void 0;
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const logger_1 = require("./utils/logger");
const errorHandler_1 = require("./middleware/errorHandler");
const socketService_1 = require("./services/socketService");
const auth_1 = __importDefault(require("./routes/auth"));
const users_1 = __importDefault(require("./routes/users"));
const servers_1 = __importDefault(require("./routes/servers"));
const nodes_1 = __importDefault(require("./routes/nodes"));
const eggs_1 = __importDefault(require("./routes/eggs"));
const backups_1 = __importDefault(require("./routes/backups"));
const stats_1 = __importDefault(require("./routes/stats"));
const wings_1 = __importDefault(require("./routes/wings"));
const app = (0, express_1.default)();
exports.app = app;
const httpServer = http_1.default.createServer(app);
const PORT = parseInt(process.env.PORT || '3001', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
// Security & middleware
app.use((0, helmet_1.default)({ contentSecurityPolicy: false }));
app.use((0, cors_1.default)({
    origin: CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, cookie_parser_1.default)());
app.use((0, morgan_1.default)('dev', { stream: { write: (msg) => logger_1.logger.http(msg.trim()) } }));
// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: process.env.PANEL_VERSION || '1.0.0', timestamp: new Date().toISOString() });
});
// API routes
const api = express_1.default.Router();
api.use('/auth', auth_1.default);
api.use('/users', users_1.default);
api.use('/servers', servers_1.default);
api.use('/servers/:serverId/backups', backups_1.default);
api.use('/nodes', nodes_1.default);
api.use('/eggs', eggs_1.default);
api.use('/stats', stats_1.default);
api.use('/wings', wings_1.default);
app.use('/api/v1', api);
// Socket.io
const io = (0, socketService_1.initSocketServer)(httpServer, CORS_ORIGIN);
exports.io = io;
app.set('io', io);
// Error handling
app.use(errorHandler_1.notFound);
app.use(errorHandler_1.errorHandler);
// Start server
httpServer.listen(PORT, '0.0.0.0', () => {
    logger_1.logger.info(`MC Manage Panel API running on port ${PORT}`);
    logger_1.logger.info(`Environment: ${process.env.NODE_ENV}`);
    logger_1.logger.info(`CORS Origin: ${CORS_ORIGIN}`);
});
//# sourceMappingURL=index.js.map