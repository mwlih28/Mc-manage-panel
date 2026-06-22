"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
exports.getConfig = getConfig;
exports.saveConfig = saveConfig;
exports.defaultConfig = defaultConfig;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const js_yaml_1 = __importDefault(require("js-yaml"));
const CONFIG_PATH = process.env.CONFIG_PATH || '/etc/mc-wings/config.yml';
const DEV_CONFIG_PATH = path_1.default.join(process.cwd(), 'config.yml');
let config = null;
function loadConfig() {
    if (config)
        return config;
    const configPath = fs_1.default.existsSync(CONFIG_PATH) ? CONFIG_PATH : DEV_CONFIG_PATH;
    if (!fs_1.default.existsSync(configPath)) {
        throw new Error(`Config file not found at ${configPath}. Run: mc-wings configure`);
    }
    const raw = fs_1.default.readFileSync(configPath, 'utf8');
    config = js_yaml_1.default.load(raw);
    return config;
}
function getConfig() {
    return loadConfig();
}
function saveConfig(cfg) {
    const configPath = fs_1.default.existsSync(path_1.default.dirname(CONFIG_PATH)) ? CONFIG_PATH : DEV_CONFIG_PATH;
    const dir = path_1.default.dirname(configPath);
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
    fs_1.default.writeFileSync(configPath, js_yaml_1.default.dump(cfg), 'utf8');
    config = cfg;
}
function defaultConfig() {
    return {
        debug: false,
        uuid: '',
        token: '',
        remote: 'http://localhost:3001',
        api: {
            host: '0.0.0.0',
            port: 8080,
            ssl: { enabled: false },
        },
        system: {
            data: '/var/lib/mc-wings/volumes',
            sftp_bind_port: 2022,
            username: 'mcwings',
            timezone: 'UTC',
        },
        docker: {
            socket: '/var/run/docker.sock',
            network: 'mc-wings',
            tmpfs_size: 100,
            container_pid_limit: 512,
        },
        throttles: {
            kill_at_count: 60,
            decay: 5,
            bytes: 0,
            check_interval_ms: 100,
            lines: 2000,
        },
    };
}
//# sourceMappingURL=index.js.map