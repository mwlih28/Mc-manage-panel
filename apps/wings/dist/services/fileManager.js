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
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const archiver_1 = __importDefault(require("archiver"));
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
async function writeFile(uuid, filePath, content) {
    const root = getServerRoot(uuid);
    const target = safePath(root, filePath);
    const dir = path_1.default.dirname(target);
    fs_1.default.mkdirSync(dir, { recursive: true });
    fs_1.default.writeFileSync(target, content, 'utf8');
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
//# sourceMappingURL=fileManager.js.map