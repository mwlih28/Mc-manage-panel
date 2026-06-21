import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { WingsConfig } from '../types';

const CONFIG_PATH = process.env.CONFIG_PATH || '/etc/mc-wings/config.yml';
const DEV_CONFIG_PATH = path.join(process.cwd(), 'config.yml');

let config: WingsConfig | null = null;

export function loadConfig(): WingsConfig {
  if (config) return config;

  const configPath = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : DEV_CONFIG_PATH;

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found at ${configPath}. Run: mc-wings configure`);
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  config = yaml.load(raw) as WingsConfig;
  return config;
}

export function getConfig(): WingsConfig {
  return loadConfig();
}

export function saveConfig(cfg: WingsConfig): void {
  const configPath = fs.existsSync(path.dirname(CONFIG_PATH)) ? CONFIG_PATH : DEV_CONFIG_PATH;
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, yaml.dump(cfg), 'utf8');
  config = cfg;
}

export function defaultConfig(): WingsConfig {
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
