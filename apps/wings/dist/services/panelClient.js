"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.panelClient = void 0;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
class PanelClient {
    constructor() {
        this.client = null;
    }
    getClient() {
        if (this.client)
            return this.client;
        const cfg = (0, config_1.getConfig)();
        this.client = axios_1.default.create({
            baseURL: `${cfg.remote}/api/v1/wings`,
            headers: {
                Authorization: `Bearer ${cfg.token}`,
                'Content-Type': 'application/json',
                'X-Wings-Node': cfg.uuid,
            },
            timeout: 10000,
        });
        return this.client;
    }
    async authenticate() {
        const client = this.getClient();
        const { data } = await client.post('/auth');
        return data;
    }
    async getServers() {
        const client = this.getClient();
        const { data } = await client.get('/servers');
        return data.servers || [];
    }
    async reportStatus(serverUuid, status) {
        const client = this.getClient();
        await client.post(`/servers/${serverUuid}/status`, { status: status.toUpperCase() }).catch(() => { });
    }
    async reportHeartbeat(load) {
        const client = this.getClient();
        await client.post('/heartbeat', { load }).catch(() => { });
    }
}
exports.panelClient = new PanelClient();
//# sourceMappingURL=panelClient.js.map