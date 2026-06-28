"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPowerAction = sendPowerAction;
exports.sendCommand = sendCommand;
exports.getServerResources = getServerResources;
exports.buildWingsConfig = buildWingsConfig;
exports.createServerOnNode = createServerOnNode;
exports.deleteServerFromNode = deleteServerFromNode;
exports.checkNodeHealth = checkNodeHealth;
exports.getNodeServers = getNodeServers;
const axios_1 = __importDefault(require("axios"));
const prisma_1 = require("../utils/prisma");
const logger_1 = require("../utils/logger");
function getNodeClient(fqdn, port, scheme, token) {
    return axios_1.default.create({
        baseURL: `${scheme}://${fqdn}:${port}/api`,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        timeout: 15000,
    });
}
async function sendPowerAction(server, action) {
    const client = getNodeClient(server.node.fqdn, server.node.daemonPort, server.node.scheme, server.node.token);
    await client.post(`/servers/${server.uuid}/power`, { action });
}
async function sendCommand(server, command) {
    const client = getNodeClient(server.node.fqdn, server.node.daemonPort, server.node.scheme, server.node.token);
    await client.post(`/servers/${server.uuid}/command`, { command });
}
async function getServerResources(server) {
    const client = getNodeClient(server.node.fqdn, server.node.daemonPort, server.node.scheme, server.node.token);
    const { data } = await client.get(`/servers/${server.uuid}/resources`);
    return data.resources;
}
function buildWingsConfig(server) {
    const env = {};
    try {
        Object.assign(env, JSON.parse(server.env));
    }
    catch { /* ignore */ }
    return {
        uuid: server.uuid,
        suspended: server.suspended,
        environment: env,
        invocation: server.startup || server.egg.startup,
        image: server.image || server.egg.dockerImage,
        installScript: server.egg.scriptInstall ?? undefined,
        scriptContainer: server.egg.scriptContainer ?? undefined,
        build: {
            memory_limit: server.memory,
            swap: server.swap,
            disk_space: server.disk,
            io_weight: server.io,
            cpu_limit: server.cpu,
            oom_disabled: server.oomDisabled,
        },
        mounts: [],
        egg: { id: server.eggId, file_denylist: [] },
        container: { image: server.image, requires_rebuild: false },
    };
}
async function createServerOnNode(server) {
    const client = getNodeClient(server.node.fqdn, server.node.daemonPort, server.node.scheme, server.node.token);
    await client.post('/servers', buildWingsConfig(server));
    logger_1.logger.info(`Server ${server.uuid} registered on Wings node ${server.node.fqdn}`);
}
async function deleteServerFromNode(server) {
    const client = getNodeClient(server.node.fqdn, server.node.daemonPort, server.node.scheme, server.node.token);
    await client.delete(`/servers/${server.uuid}`);
}
async function checkNodeHealth(fqdn, port, scheme, token) {
    try {
        const client = getNodeClient(fqdn, port, scheme, token);
        await client.get('/health');
        return true;
    }
    catch {
        return false;
    }
}
// Called by Wings daemon to list its servers
async function getNodeServers(nodeId) {
    const servers = await prisma_1.prisma.server.findMany({
        where: { nodeId },
        include: {
            egg: { select: { startup: true, dockerImage: true, scriptInstall: true, scriptContainer: true } },
        },
    });
    return servers.map(server => {
        const env = {};
        try {
            Object.assign(env, JSON.parse(server.env));
        }
        catch { /* ignore */ }
        return {
            uuid: server.uuid,
            suspended: server.suspended,
            environment: env,
            invocation: server.startup,
            image: server.image,
            installScript: server.egg.scriptInstall ?? undefined,
            scriptContainer: server.egg.scriptContainer ?? undefined,
            build: {
                memory_limit: server.memory,
                swap: server.swap,
                disk_space: server.disk,
                io_weight: server.io,
                cpu_limit: server.cpu,
                oom_disabled: server.oomDisabled,
            },
            mounts: [],
            egg: { id: server.eggId, file_denylist: [] },
            container: { image: server.image, requires_rebuild: false },
        };
    });
}
//# sourceMappingURL=wingsClient.js.map