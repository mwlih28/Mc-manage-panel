"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const axios_1 = __importDefault(require("axios"));
const serverManager_1 = require("../services/serverManager");
const logger_1 = require("../utils/logger");
const config_1 = require("../config");
const mcPing_1 = require("../services/mcPing");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
const router = (0, express_1.Router)();
// Load/register a server
router.post('/', async (req, res) => {
    const config = req.body;
    try {
        await serverManager_1.serverManager.loadServer(config);
        return res.status(201).json({ message: 'Server loaded' });
    }
    catch (err) {
        logger_1.logger.error('Failed to load server:', err);
        return res.status(500).json({ message: err.message });
    }
});
// Power action
router.post('/:uuid/power', async (req, res) => {
    const { uuid } = req.params;
    const { action } = req.body;
    if (!['start', 'stop', 'restart', 'kill'].includes(action)) {
        return res.status(422).json({ message: 'Invalid action' });
    }
    try {
        switch (action) {
            case 'start':
                serverManager_1.serverManager.startServer(uuid).catch(err => logger_1.logger.error(`Start failed: ${err.message}`));
                break;
            case 'stop':
                serverManager_1.serverManager.stopServer(uuid).catch(err => logger_1.logger.error(`Stop failed: ${err.message}`));
                break;
            case 'restart':
                serverManager_1.serverManager.restartServer(uuid).catch(err => logger_1.logger.error(`Restart failed: ${err.message}`));
                break;
            case 'kill':
                serverManager_1.serverManager.killServer(uuid).catch(err => logger_1.logger.error(`Kill failed: ${err.message}`));
                break;
        }
        return res.json({ message: `${action} initiated` });
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
});
// Send command
router.post('/:uuid/command', async (req, res) => {
    const { uuid } = req.params;
    const { command } = req.body;
    if (!command)
        return res.status(422).json({ message: 'Command required' });
    await serverManager_1.serverManager.sendCommand(uuid, command);
    return res.json({ message: 'Command sent' });
});
// Get resources/stats
router.get('/:uuid/resources', async (req, res) => {
    const { uuid } = req.params;
    const resources = await serverManager_1.serverManager.getResources(uuid);
    return res.json({ resources });
});
// Get status
router.get('/:uuid/status', (req, res) => {
    const status = serverManager_1.serverManager.getStatus(req.params.uuid);
    return res.json({ status });
});
// Delete server
router.delete('/:uuid', async (req, res) => {
    try {
        await serverManager_1.serverManager.deleteServer(req.params.uuid);
        return res.status(204).send();
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
});
// Get online players via Minecraft Server List Ping
router.get('/:uuid/players', async (req, res) => {
    const { uuid } = req.params;
    const env = serverManager_1.serverManager.getServerEnvironment(uuid);
    const port = parseInt(env['SERVER_PORT'] || env['PORT'] || '25565', 10);
    try {
        const result = await (0, mcPing_1.pingServer)('127.0.0.1', port, 4000);
        return res.json(result);
    }
    catch {
        return res.json({ online: 0, max: 0, players: [] });
    }
});
// Install a plugin/mod by downloading from a URL
router.post('/:uuid/plugins/install', async (req, res) => {
    const { uuid } = req.params;
    const { url, filename, type } = req.body;
    if (!url || !filename || !['plugins', 'mods'].includes(type)) {
        return res.status(422).json({ message: 'url, filename, and type (plugins|mods) required' });
    }
    if (!url.startsWith('https://')) {
        return res.status(422).json({ message: 'Only HTTPS URLs are allowed' });
    }
    const safeFilename = path_1.default.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeFilename.endsWith('.jar')) {
        return res.status(422).json({ message: 'Only .jar files are supported' });
    }
    const cfg = (0, config_1.getConfig)();
    const expectedBase = path_1.default.resolve(path_1.default.join(cfg.system.data, uuid));
    const targetDir = path_1.default.resolve(path_1.default.join(expectedBase, type));
    if (!targetDir.startsWith(expectedBase)) {
        return res.status(403).json({ message: 'Forbidden path' });
    }
    // Download to a temporary directory, then copy into the container via docker cp.
    // Wings runs as a non-root user (mcwings) that cannot write to the volume dirs
    // owned by uid 1000. docker cp goes through the Docker daemon (root), bypassing
    // this restriction and working on both running and stopped containers.
    const tmpDir = path_1.default.join(os_1.default.tmpdir(), `mc_install_${Date.now()}_${uuid}`);
    const tmpFile = path_1.default.join(tmpDir, safeFilename);
    try {
        fs_1.default.mkdirSync(tmpDir, { recursive: true });
        const response = await axios_1.default.get(url, {
            responseType: 'stream',
            timeout: 60000,
            maxContentLength: 100 * 1024 * 1024,
        });
        await new Promise((resolve, reject) => {
            const writer = fs_1.default.createWriteStream(tmpFile);
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        const containerName = `mc_${uuid}`;
        // Ensure target dir exists inside the container (only works if running; ignore failure)
        await execFileAsync('docker', ['exec', containerName, 'mkdir', '-p', `/home/container/${type}`]).catch(() => { });
        // Copy the temp directory's contents into the container.
        // Using srcDir/ → destDir creates the destination directory if it doesn't exist,
        // and works on stopped containers (Docker daemon handles the copy as root).
        try {
            await execFileAsync('docker', ['cp', tmpDir + '/', `${containerName}:/home/container/${type}`]);
            logger_1.logger.info(`Plugin installed via docker cp: ${safeFilename}`);
            return res.json({ message: `${safeFilename} installed successfully` });
        }
        catch {
            // Container doesn't exist yet (never started) — write via a helper container
            // that mounts the volume as root and can set correct ownership.
            const dataPath = path_1.default.join(cfg.system.data, uuid);
            await execFileAsync('docker', [
                'run', '--rm',
                '-v', `${dataPath}:/vol`,
                '-v', `${tmpDir}:/src:ro`,
                'alpine',
                'sh', '-c',
                `mkdir -p /vol/${type} && cp /src/${safeFilename} /vol/${type}/${safeFilename} && chown 1000:1000 /vol/${type}/${safeFilename}`,
            ]);
            logger_1.logger.info(`Plugin installed via helper container: ${safeFilename}`);
            return res.json({ message: `${safeFilename} installed successfully` });
        }
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
    finally {
        try {
            fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
        }
        catch { /* ignore */ }
    }
});
// GET /api/servers/:uuid/versions — list Paper MC versions
router.get('/:uuid/versions', async (_req, res) => {
    try {
        const { data } = await axios_1.default.get('https://api.papermc.io/v2/projects/paper', { timeout: 10000 });
        return res.json({ versions: data.versions.reverse() });
    }
    catch {
        return res.status(500).json({ message: 'Failed to fetch Paper versions' });
    }
});
// GET /api/servers/:uuid/versions/:version/builds
router.get('/:uuid/versions/:version/builds', async (req, res) => {
    const { version } = req.params;
    try {
        const { data } = await axios_1.default.get(`https://api.papermc.io/v2/projects/paper/versions/${version}`, { timeout: 10000 });
        const builds = data.builds;
        return res.json({ builds: builds.reverse(), latestBuild: builds[0] });
    }
    catch {
        return res.status(500).json({ message: 'Failed to fetch builds' });
    }
});
// POST /api/servers/:uuid/version — download and install specific Paper version
router.post('/:uuid/version', async (req, res) => {
    const { uuid } = req.params;
    const { version, build } = req.body;
    if (!version)
        return res.status(422).json({ message: 'version required' });
    const cfg = (0, config_1.getConfig)();
    const dataPath = path_1.default.join(cfg.system.data, uuid);
    const tmpDir = path_1.default.join(os_1.default.tmpdir(), `mc_ver_${Date.now()}_${uuid}`);
    const tmpFile = path_1.default.join(tmpDir, 'paper.jar');
    try {
        let targetBuild = build;
        if (!targetBuild) {
            const { data: bd } = await axios_1.default.get(`https://api.papermc.io/v2/projects/paper/versions/${version}`, { timeout: 10000 });
            const builds = bd.builds;
            targetBuild = builds[builds.length - 1];
        }
        const jarName = `paper-${version}-${targetBuild}.jar`;
        const downloadUrl = `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${targetBuild}/downloads/${jarName}`;
        logger_1.logger.info(`Downloading Paper ${version}-${targetBuild} for ${uuid}`);
        fs_1.default.mkdirSync(tmpDir, { recursive: true });
        const response = await axios_1.default.get(downloadUrl, {
            responseType: 'stream',
            timeout: 120000,
            maxContentLength: 200 * 1024 * 1024,
        });
        await new Promise((resolve, reject) => {
            const writer = fs_1.default.createWriteStream(tmpFile);
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        const containerName = `mc_${uuid}`;
        try {
            await execFileAsync('docker', ['cp', tmpFile, `${containerName}:/home/container/server.jar`]);
            await execFileAsync('docker', ['exec', containerName, 'chown', '1000:1000', '/home/container/server.jar']).catch(() => { });
        }
        catch {
            await execFileAsync('docker', [
                'run', '--rm',
                '-v', `${dataPath}:/vol`,
                '-v', `${tmpDir}:/src:ro`,
                'alpine', 'sh', '-c',
                'cp /src/paper.jar /vol/server.jar && chown 1000:1000 /vol/server.jar && chmod 666 /vol/server.jar',
            ]);
        }
        logger_1.logger.info(`Paper ${version}-${targetBuild} installed for ${uuid}`);
        return res.json({ message: `Paper ${version} build ${targetBuild} installed`, version, build: targetBuild });
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
    finally {
        try {
            fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
        }
        catch { /* ignore */ }
    }
});
exports.default = router;
//# sourceMappingURL=servers.js.map