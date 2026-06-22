"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.consoleBuffer = void 0;
exports.pushConsoleBuffer = pushConsoleBuffer;
exports.getOrConnectWings = getOrConnectWings;
exports.subscribeServerOnWings = subscribeServerOnWings;
exports.sendCommandToWings = sendCommandToWings;
exports.sendPowerToWings = sendPowerToWings;
exports.disconnectNode = disconnectNode;
const socket_io_client_1 = require("socket.io-client");
const logger_1 = require("../utils/logger");
const MAX_CONSOLE_BUFFER = 300;
exports.consoleBuffer = new Map();
function pushConsoleBuffer(uuid, line) {
    const buf = exports.consoleBuffer.get(uuid) ?? [];
    buf.push(line);
    if (buf.length > MAX_CONSOLE_BUFFER)
        buf.shift();
    exports.consoleBuffer.set(uuid, buf);
}
const nodeConnections = new Map();
const WINGS_TO_PANEL_STATUS = {
    running: 'RUNNING', offline: 'OFFLINE', starting: 'STARTING', stopping: 'STOPPING', installing: 'INSTALLING',
};
function getOrConnectWings(node, io) {
    const existing = nodeConnections.get(node.id);
    if (existing) {
        return existing.socket;
    }
    const url = `${node.scheme}://${node.fqdn}:${node.daemonPort}`;
    const subscribedUuids = new Set();
    const wingsSocket = (0, socket_io_client_1.io)(url, {
        auth: { token: node.token },
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 3000,
    });
    wingsSocket.on('connect', () => {
        logger_1.logger.info(`Wings relay connected to node ${node.id} (${url})`);
        for (const uuid of subscribedUuids) {
            wingsSocket.emit('subscribe', uuid);
            logger_1.logger.debug(`Subscribed server ${uuid} on node ${node.id}`);
        }
    });
    wingsSocket.on('connect_error', (err) => {
        logger_1.logger.warn(`Wings relay error for node ${node.id}: ${err.message}`);
    });
    wingsSocket.on('disconnect', (reason) => {
        logger_1.logger.warn(`Wings relay disconnected from node ${node.id}: ${reason}`);
    });
    // Relay all Wings events to panel clients in the correct room
    wingsSocket.onAny((event, data) => {
        const handled = ['server:console', 'server:stats', 'server:status', 'server:console:history'];
        if (!handled.includes(event))
            return;
        const payload = data;
        const uuid = payload?.uuid;
        // Wings sends history as { uuid, lines[] } so we can route it correctly
        if (event === 'server:console:history') {
            const h = data;
            if (h.uuid && Array.isArray(h.lines) && h.lines.length > 0) {
                h.lines.forEach((l) => pushConsoleBuffer(h.uuid, l));
                io.to(`server:uuid:${h.uuid}`).emit('server:console:history', h.lines);
            }
            return;
        }
        if (!uuid)
            return;
        let relayData = data;
        if (event === 'server:status' && payload.state) {
            const panelStatus = WINGS_TO_PANEL_STATUS[payload.state]
                ?? payload.state.toUpperCase();
            relayData = { ...payload, status: panelStatus };
        }
        if (event === 'server:stats') {
            relayData = {
                uuid,
                cpuAbsolute: typeof payload.cpu_absolute === 'number' ? payload.cpu_absolute : 0,
                memoryBytes: typeof payload.memory_bytes === 'number' ? payload.memory_bytes : 0,
                memoryLimitBytes: typeof payload.memory_limit_bytes === 'number' ? payload.memory_limit_bytes : 0,
                diskBytes: typeof payload.disk_bytes === 'number' ? payload.disk_bytes : 0,
                networkRxBytes: typeof payload.network_rx_bytes === 'number' ? payload.network_rx_bytes : 0,
                networkTxBytes: typeof payload.network_tx_bytes === 'number' ? payload.network_tx_bytes : 0,
                uptime: typeof payload.uptime === 'number' ? payload.uptime : 0,
                timestamp: Date.now(),
            };
        }
        if (event === 'server:console') {
            pushConsoleBuffer(uuid, {
                type: payload.type ?? 'output',
                data: payload.data ?? '',
                timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
            });
        }
        io.to(`server:uuid:${uuid}`).emit(event, relayData);
    });
    nodeConnections.set(node.id, { socket: wingsSocket, subscribedUuids });
    return wingsSocket;
}
function subscribeServerOnWings(nodeId, serverUuid) {
    const conn = nodeConnections.get(nodeId);
    if (!conn)
        return;
    conn.subscribedUuids.add(serverUuid);
    if (conn.socket.connected) {
        conn.socket.emit('subscribe', serverUuid);
        logger_1.logger.debug(`Subscribed server ${serverUuid} on node ${nodeId}`);
    }
}
function sendCommandToWings(nodeId, serverUuid, command) {
    const conn = nodeConnections.get(nodeId);
    if (conn?.socket.connected) {
        conn.socket.emit('command', { uuid: serverUuid, command });
    }
}
function sendPowerToWings(nodeId, serverUuid, action) {
    const conn = nodeConnections.get(nodeId);
    if (conn?.socket.connected) {
        conn.socket.emit('power', { uuid: serverUuid, action });
    }
}
function disconnectNode(nodeId) {
    const conn = nodeConnections.get(nodeId);
    if (conn) {
        conn.socket.disconnect();
        nodeConnections.delete(nodeId);
    }
}
//# sourceMappingURL=wingsRelay.js.map