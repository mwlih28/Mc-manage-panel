"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listDirectory = listDirectory;
exports.readFile = readFile;
exports.writeFile = writeFile;
exports.deleteFiles = deleteFiles;
exports.createDirectory = createDirectory;
exports.renameFile = renameFile;
exports.createBackup = createBackup;
exports.listWorlds = listWorlds;
exports.getActiveWorldName = getActiveWorldName;
exports.setActiveWorldName = setActiveWorldName;
exports.installWorldFromZipFile = installWorldFromZipFile;
exports.createWorldZipStream = createWorldZipStream;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const archiver_1 = __importDefault(require("archiver"));
const extract_zip_1 = __importDefault(require("extract-zip"));
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
function getServerRoot(uuid) {
    const cfg = (0, config_1.getConfig)();
    return path_1.default.join(cfg.system.data, uuid);
}
function safePath(root, filePath) {
    const resolved = path_1.default.resolve(root, filePath.replace(/^\/+/, ''));
    if (!resolved.startsWith(root)) {
        throw new Error('Path traversal attempt detected');
    }
    return resolved;
}
async function listDirectory(uuid, dirPath = '/') {
    const root = getServerRoot(uuid);
    const target = safePath(root, dirPath);
    if (!fs_1.default.existsSync(target))
        return [];
    const entries = fs_1.default.readdirSync(target, { withFileTypes: true });
    return entries.map(entry => {
        const fullPath = path_1.default.join(target, entry.name);
        let stat;
        try {
            stat = fs_1.default.statSync(fullPath);
        }
        catch {
            return null;
        }
        return {
            name: entry.name,
            size: stat.size,
            mode: (stat.mode & 0o777).toString(8),
            isFile: entry.isFile(),
            isDir: entry.isDirectory(),
            isSymlink: entry.isSymbolicLink(),
            modifiedAt: stat.mtime,
        };
    }).filter(Boolean);
}
async function readFile(uuid, filePath) {
    const root = getServerRoot(uuid);
    const target = safePath(root, filePath);
    if (!fs_1.default.existsSync(target))
        throw new Error('File not found');
    const stat = fs_1.default.statSync(target);
    if (stat.size > 5 * 1024 * 1024)
        throw new Error('File too large to edit (>5MB)');
    return fs_1.default.readFileSync(target, 'utf8');
}
async function writeFile(uuid, filePath, content, encoding = 'utf8') {
    const root = getServerRoot(uuid);
    const target = safePath(root, filePath);
    const dir = path_1.default.dirname(target);
    fs_1.default.mkdirSync(dir, { recursive: true });
    // File may be owned by container uid 1000; unlink first so we can recreate it
    // as the Wings process user. Directory write permission is sufficient to unlink.
    if (fs_1.default.existsSync(target)) {
        try {
            fs_1.default.unlinkSync(target);
        }
        catch { /* fall through */ }
    }
    const data = encoding === 'base64' ? Buffer.from(content, 'base64') : content;
    fs_1.default.writeFileSync(target, data, { mode: 0o666 });
    logger_1.logger.debug(`File written: ${filePath} for server ${uuid}`);
}
async function deleteFiles(uuid, filePaths) {
    const root = getServerRoot(uuid);
    for (const filePath of filePaths) {
        const target = safePath(root, filePath);
        if (!fs_1.default.existsSync(target))
            continue;
        fs_1.default.rmSync(target, { recursive: true, force: true });
        logger_1.logger.debug(`Deleted: ${filePath} for server ${uuid}`);
    }
}
async function createDirectory(uuid, dirPath) {
    const root = getServerRoot(uuid);
    const target = safePath(root, dirPath);
    fs_1.default.mkdirSync(target, { recursive: true });
}
async function renameFile(uuid, from, to) {
    const root = getServerRoot(uuid);
    const fromPath = safePath(root, from);
    const toPath = safePath(root, to);
    fs_1.default.renameSync(fromPath, toPath);
}
async function createBackup(uuid, name, ignored) {
    const root = getServerRoot(uuid);
    const cfg = (0, config_1.getConfig)();
    const backupDir = path_1.default.join(cfg.system.data, '..', 'backups', uuid);
    fs_1.default.mkdirSync(backupDir, { recursive: true });
    const backupFile = path_1.default.join(backupDir, `${name}.tar.gz`);
    return new Promise((resolve, reject) => {
        const output = fs_1.default.createWriteStream(backupFile);
        const archive = (0, archiver_1.default)('tar', { gzip: true, gzipOptions: { level: 6 } });
        output.on('close', () => {
            const stat = fs_1.default.statSync(backupFile);
            resolve({ path: backupFile, size: stat.size, checksum: '' });
        });
        archive.on('error', reject);
        archive.pipe(output);
        archive.glob('**/*', {
            cwd: root,
            ignore: [...ignored, '*.log', '*.lock'],
            dot: false,
        });
        archive.finalize();
    });
}
// ── World management ──────────────────────────────────────────────────────────
function dirSizeSync(dir) {
    let total = 0;
    let entries;
    try {
        entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return 0;
    }
    for (const entry of entries) {
        const full = path_1.default.join(dir, entry.name);
        if (entry.isDirectory())
            total += dirSizeSync(full);
        else if (entry.isFile()) {
            try {
                total += fs_1.default.statSync(full).size;
            }
            catch { /* ignore races with concurrent writes */ }
        }
    }
    return total;
}
// A world folder is one containing level.dat at its root. Downloaded world
// zips commonly wrap the actual world in a single named subfolder, so this
// checks the given dir and, failing that, one level of subdirectories.
function findLevelDatRoot(dir) {
    if (fs_1.default.existsSync(path_1.default.join(dir, 'level.dat')))
        return dir;
    let entries;
    try {
        entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return null;
    }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            const sub = path_1.default.join(dir, entry.name);
            if (fs_1.default.existsSync(path_1.default.join(sub, 'level.dat')))
                return sub;
        }
    }
    return null;
}
async function listWorlds(uuid) {
    const root = getServerRoot(uuid);
    const active = getActiveWorldName(uuid);
    if (!fs_1.default.existsSync(root))
        return [];
    const entries = fs_1.default.readdirSync(root, { withFileTypes: true });
    const worlds = [];
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const full = path_1.default.join(root, entry.name);
        if (fs_1.default.existsSync(path_1.default.join(full, 'level.dat'))) {
            worlds.push({ name: entry.name, size: dirSizeSync(full), active: entry.name === active });
        }
    }
    return worlds;
}
function getActiveWorldName(uuid) {
    const root = getServerRoot(uuid);
    const propsPath = path_1.default.join(root, 'server.properties');
    if (!fs_1.default.existsSync(propsPath))
        return 'world';
    const content = fs_1.default.readFileSync(propsPath, 'utf8');
    const match = content.match(/^level-name=(.*)$/m);
    return match ? match[1].trim() || 'world' : 'world';
}
async function setActiveWorldName(uuid, worldName) {
    const root = getServerRoot(uuid);
    const propsPath = path_1.default.join(root, 'server.properties');
    let content = fs_1.default.existsSync(propsPath) ? fs_1.default.readFileSync(propsPath, 'utf8') : '';
    if (/^level-name=.*$/m.test(content)) {
        content = content.replace(/^level-name=.*$/m, `level-name=${worldName}`);
    }
    else {
        content += `${content.endsWith('\n') || content === '' ? '' : '\n'}level-name=${worldName}\n`;
    }
    fs_1.default.writeFileSync(propsPath, content, { mode: 0o666 });
}
// Downloads happen via a URL fetched by the route handler into a temp zip
// file — this just handles extraction, world-root detection, and placing it
// under the server as a new world folder.
async function installWorldFromZipFile(uuid, zipPath, worldName) {
    const root = getServerRoot(uuid);
    const safeName = worldName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'world';
    const target = safePath(root, safeName);
    if (fs_1.default.existsSync(target))
        throw new Error(`A world named "${safeName}" already exists`);
    const tmpDir = path_1.default.join(os_1.default.tmpdir(), `mc_world_${Date.now()}_${uuid}`);
    fs_1.default.mkdirSync(tmpDir, { recursive: true });
    try {
        await (0, extract_zip_1.default)(zipPath, { dir: tmpDir });
        const worldRoot = findLevelDatRoot(tmpDir);
        if (!worldRoot)
            throw new Error('No level.dat found in the downloaded world archive');
        fs_1.default.mkdirSync(target, { recursive: true });
        fs_1.default.cpSync(worldRoot, target, { recursive: true });
        logger_1.logger.info(`World "${safeName}" installed for ${uuid}`);
    }
    finally {
        fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
    }
}
function createWorldZipStream(uuid, worldName) {
    const root = getServerRoot(uuid);
    const worldPath = safePath(root, worldName);
    if (!fs_1.default.existsSync(path_1.default.join(worldPath, 'level.dat'))) {
        throw new Error('Not a valid world folder');
    }
    const archive = (0, archiver_1.default)('zip', { zlib: { level: 6 } });
    archive.directory(worldPath, worldName);
    archive.finalize();
    return archive;
}
//# sourceMappingURL=fileManager.js.map