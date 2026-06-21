import readline from 'readline';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { defaultConfig, saveConfig } from '../config';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

async function setup() {
  console.log('\n=== MC Wings Daemon Setup ===\n');

  const panelUrl = await ask('Panel URL (e.g. https://panel.yourdomain.com): ');
  const token = await ask('Wings Token (from Panel → Nodes → Your Node → Config): ');
  const port = await ask('Wings API Port [8080]: ') || '8080';
  const dataDir = await ask('Server data directory [/var/lib/mc-wings/volumes]: ') || '/var/lib/mc-wings/volumes';

  // Try to connect to panel
  console.log('\nConnecting to panel...');
  try {
    const { data } = await axios.post(`${panelUrl}/api/v1/wings/auth`, {}, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    });
    console.log(`✓ Connected to panel as node: ${data.name}`);

    const cfg = defaultConfig();
    cfg.uuid = data.uuid || uuidv4();
    cfg.token = token;
    cfg.remote = panelUrl;
    cfg.api.port = parseInt(port);
    cfg.system.data = dataDir;

    saveConfig(cfg);
    console.log('\n✓ Configuration saved to /etc/mc-wings/config.yml');
    console.log('\nRun "mc-wings start" or "systemctl start mc-wings" to start the daemon.\n');
  } catch (err) {
    console.error('\n✗ Could not connect to panel:', (err as Error).message);
    console.log('\nSaving config anyway — verify your panel URL and token.\n');

    const cfg = defaultConfig();
    cfg.uuid = uuidv4();
    cfg.token = token;
    cfg.remote = panelUrl;
    cfg.api.port = parseInt(port);
    cfg.system.data = dataDir;
    saveConfig(cfg);
  }

  rl.close();
}

setup().catch(console.error);
