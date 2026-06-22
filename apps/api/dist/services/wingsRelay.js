"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrConnectWings = getOrConnectWings;
exports.subscribeServerOnWings = subscribeServerOnWings;
exports.sendCommandToWings = sendCommandToWings;
exports.sendPowerToWings = sendPowerToWings;
exports.disconnectNode = disconnectNode;
const socket_io_client_1 = require("socket.io-client");
const logger_1 = require("../utils/logger");
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
        // Re-subscribe all servers after every (re)connect
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
        // Do NOT delete from map — socket.io will auto-reconnect and re-subscribe
    });
    // Relay all Wings events to panel clients in the correct room
    wingsSocket.onAny((event, data) => {
        if (event === 'server:console' || event === 'server:stats' || event === 'server:status') {
            const payload = data;
            const uuid = payload?.uuid;
            if (uuid) {
                let relayData = data;
                // Normalize Wings lowercase status → panel uppercase
                if (event === 'server:status' && payload.state) {
                    const panelStatus = WINGS_TO_PANEL_STATUS[payload.state]
                        ?? payload.state.toUpperCase();
                    relayData = { ...payload, status: panelStatus };
                }
                io.to(`server:uuid:${uuid}`).emit(event, relayData);
            }
        }
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
    // If not connected yet, the 'connect' handler above will send all pending subs
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