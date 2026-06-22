"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pingServer = pingServer;
const net_1 = __importDefault(require("net"));
function encodeVarInt(value) {
    const bytes = [];
    do {
        let byte = value & 0x7f;
        value >>>= 7;
        if (value !== 0)
            byte |= 0x80;
        bytes.push(byte);
    } while (value !== 0);
    return Buffer.from(bytes);
}
function decodeVarInt(buf, offset) {
    let value = 0;
    let size = 0;
    let byte;
    do {
        if (offset + size >= buf.length)
            throw new Error('Buffer too short');
        byte = buf[offset + size];
        value |= (byte & 0x7f) << (7 * size);
        size++;
        if (size > 5)
            throw new Error('VarInt too large');
    } while (byte & 0x80);
    return { value, size };
}
function encodeString(str) {
    const encoded = Buffer.from(str, 'utf8');
    return Buffer.concat([encodeVarInt(encoded.length), encoded]);
}
function buildHandshake(host, port) {
    const packetId = encodeVarInt(0x00);
    const protocolVersion = encodeVarInt(764); // 1.20.4
    const serverAddress = encodeString(host);
    const serverPort = Buffer.alloc(2);
    serverPort.writeUInt16BE(port, 0);
    const nextState = encodeVarInt(1);
    const payload = Buffer.concat([packetId, protocolVersion, serverAddress, serverPort, nextState]);
    return Buffer.concat([encodeVarInt(payload.length), payload]);
}
function buildStatusRequest() {
    const payload = encodeVarInt(0x00);
    return Buffer.concat([encodeVarInt(payload.length), payload]);
}
async function pingServer(host, port, timeoutMs = 5000) {
    return new Promise((resolve) => {
        const fallback = { online: 0, max: 0, players: [] };
        let settled = false;
        const done = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            resolve(result);
        };
        const timer = setTimeout(() => done(fallback), timeoutMs);
        const socket = net_1.default.createConnection({ host, port }, () => {
            socket.write(buildHandshake(host, port));
            socket.write(buildStatusRequest());
        });
        socket.on('error', () => done(fallback));
        let buf = Buffer.alloc(0);
        socket.on('data', (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            try {
                // Read packet length
                const lenField = decodeVarInt(buf, 0);
                const totalLen = lenField.size + lenField.value;
                if (buf.length < totalLen)
                    return; // wait for more data
                // Read packet ID
                const idField = decodeVarInt(buf, lenField.size);
                if (idField.value !== 0x00)
                    return done(fallback);
                // Read JSON string
                let strOffset = lenField.size + idField.size;
                const strLen = decodeVarInt(buf, strOffset);
                strOffset += strLen.size;
                const json = buf.slice(strOffset, strOffset + strLen.value).toString('utf8');
                const parsed = JSON.parse(json);
                const result = {
                    online: parsed?.players?.online ?? 0,
                    max: parsed?.players?.max ?? 0,
                    players: (parsed?.players?.sample ?? []).map((p) => ({
                        name: p.name,
                        id: p.id,
                    })),
                };
                done(result);
            }
            catch {
                // incomplete data — wait for more
            }
        });
    });
}
//# sourceMappingURL=mcPing.js.map