"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const readline_1 = __importDefault(require("readline"));
const axios_1 = __importDefault(require("axios"));
const uuid_1 = require("uuid");
const config_1 = require("../config");
const rl = readline_1.default.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));
async function setup() {
    console.log('\n=== MC Wings Daemon Setup ===\n');
    const panelUrl = await ask('Panel URL (e.g. https://panel.yourdomain.com): ');
    const token = await ask('Wings Token (from Panel → Nodes → Your Node → Config): ');
    const port = await ask('Wings API Port [8080]: ') || '8080';
    const dataDir = await ask('Server data directory [/var/lib/mc-wings/volumes]: ') || '/var/lib/mc-wings/volumes';
    // Try to connect to panel
    console.log('\nConnecting to panel...');
    try {
        const { data } = await axios_1.default.post(`${panelUrl}/api/v1/wings/auth`, {}, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 5000,
        });
        console.log(`✓ Connected to panel as node: ${data.name}`);
        const cfg = (0, config_1.defaultConfig)();
        cfg.uuid = data.uuid || (0, uuid_1.v4)();
        cfg.token = token;
        cfg.remote = panelUrl;
        cfg.api.port = parseInt(port);
        cfg.system.data = dataDir;
        (0, config_1.saveConfig)(cfg);
        console.log('\n✓ Configuration saved to /etc/mc-wings/config.yml');
        console.log('\nRun "mc-wings start" or "systemctl start mc-wings" to start the daemon.\n');
    }
    catch (err) {
        console.error('\n✗ Could not connect to panel:', err.message);
        console.log('\nSaving config anyway — verify your panel URL and token.\n');
        const cfg = (0, config_1.defaultConfig)();
        cfg.uuid = (0, uuid_1.v4)();
        cfg.token = token;
        cfg.remote = panelUrl;
        cfg.api.port = parseInt(port);
        cfg.system.data = dataDir;
        (0, config_1.saveConfig)(cfg);
    }
    rl.close();
}
setup().catch(console.error);
//# sourceMappingURL=setup.js.map