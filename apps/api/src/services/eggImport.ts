import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../utils/prisma';

// Parses a Pterodactyl egg export (the "PTDL_v1"/"PTDL_v2" JSON format every
// panel in this ecosystem — Pterodactyl, Pelican, and the community egg
// repos that target them — produces from "Export Egg"). Deliberately
// tolerant of the two real-world variants seen in the wild: a
// `docker_images` map (current) vs. a single `docker_image` string (older
// exports), and `config.*` values that are sometimes plain strings and
// sometimes still-nested objects depending on which tool produced the file.
export interface ParsedEgg {
  name: string;
  author: string;
  description: string;
  dockerImage: string;
  configFiles: string;
  configStartup: string;
  configStop: string;
  configLogs: string;
  startup: string;
  scriptInstall: string | null;
  scriptEntry: string;
  scriptContainer: string;
  logoUrl: string | null;
  variables: Array<{
    name: string;
    description: string;
    envVariable: string;
    defaultValue: string;
    userViewable: boolean;
    userEditable: boolean;
    rules: string;
  }>;
}

// Most SteamCMD-family eggs in the pelican-eggs community repo expose a
// Steam App ID as a variable. Verified against live eggs this is usually
// the *dedicated server* App ID (what SteamCMD actually downloads), which
// is frequently a different, unlisted app from the game's real store page
// and has no header art of its own (e.g. Rust's server id 258550 vs. the
// game's own id 252490) — so the App ID alone isn't safe to turn into a
// CDN image URL by guessing a path. Steam's own public appdetails API
// tells us definitively whether an id is a real store listing and, when it
// is, hands back its actual header image — used here instead of assuming.
const APPID_VAR_NAMES = /^(SRCDS_APPID|STEAM_APPID|APP_ID|APPID)$/i;

async function resolveSteamLogo(
  variables: Array<{ envVariable: string; defaultValue: string }>,
  installScript: string | null
): Promise<string | null> {
  const fromVar = variables.find((v) => APPID_VAR_NAMES.test(v.envVariable) && /^\d{2,7}$/.test(v.defaultValue));
  const appId = fromVar?.defaultValue || installScript?.match(/app_update\s+(\d{2,7})/)?.[1];
  if (!appId) return null;

  try {
    const { data } = await axios.get(`https://store.steampowered.com/api/appdetails`, {
      params: { appids: appId },
      timeout: 6000,
    });
    const entry = data?.[appId];
    return entry?.success && typeof entry.data?.header_image === 'string' ? entry.data.header_image : null;
  } catch {
    return null;
  }
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return fallback;
  return JSON.stringify(value);
}

export async function parsePterodactylEgg(raw: unknown): Promise<ParsedEgg> {
  if (!raw || typeof raw !== 'object') throw new Error('Egg JSON must be an object');
  const j = raw as Record<string, unknown>;

  if (typeof j.name !== 'string' || !j.name.trim()) throw new Error('Egg JSON is missing "name"');
  if (typeof j.startup !== 'string' || !j.startup.trim()) throw new Error('Egg JSON is missing "startup"');

  let dockerImage = '';
  if (j.docker_images && typeof j.docker_images === 'object') {
    const values = Object.values(j.docker_images as Record<string, unknown>).filter((v) => typeof v === 'string') as string[];
    dockerImage = values[0] || '';
  } else if (typeof j.docker_image === 'string') {
    dockerImage = j.docker_image;
  }
  if (!dockerImage) throw new Error('Egg JSON has no usable docker image');

  const config = (j.config && typeof j.config === 'object' ? j.config : {}) as Record<string, unknown>;
  const installation = (
    j.scripts && typeof j.scripts === 'object'
      ? (j.scripts as Record<string, unknown>).installation
      : undefined
  );
  const scripts = (installation && typeof installation === 'object' ? installation : {}) as Record<string, unknown>;

  const rawVariables = Array.isArray(j.variables) ? j.variables : [];
  const variables = rawVariables
    .map((v) => {
      const vv = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
      const envVariable = asString(vv.env_variable ?? vv.envVariable).toUpperCase();
      return {
        name: asString(vv.name, envVariable || 'Variable'),
        description: asString(vv.description),
        envVariable,
        defaultValue: vv.default_value !== undefined ? asString(vv.default_value) : asString(vv.defaultValue),
        userViewable: vv.user_viewable !== false && vv.userViewable !== false,
        userEditable: vv.user_editable !== false && vv.userEditable !== false,
        rules: asString(vv.rules),
      };
    })
    .filter((v) => v.envVariable);

  const scriptInstall = typeof scripts.script === 'string' && scripts.script ? scripts.script : null;

  return {
    name: j.name.trim().slice(0, 191),
    author: typeof j.author === 'string' && j.author.trim() ? j.author.trim() : 'community@import',
    description: typeof j.description === 'string' ? j.description : '',
    dockerImage,
    configFiles: asString(config.files, '[]'),
    configStartup: asString(config.startup, '{}'),
    configStop: typeof config.stop === 'string' && config.stop ? config.stop : '^C',
    configLogs: asString(config.logs, '{}'),
    startup: j.startup.trim(),
    scriptInstall,
    scriptEntry: typeof scripts.entrypoint === 'string' && scripts.entrypoint ? scripts.entrypoint : 'bash',
    scriptContainer: typeof scripts.container === 'string' && scripts.container ? scripts.container : 'alpine:3.4',
    logoUrl: await resolveSteamLogo(variables, scriptInstall),
    variables,
  };
}

// Resolves nestId (existing) or nestName (find-or-create) — the same
// resolution POST /eggs already does inline, pulled out here so the JSON
// import route and the community-store bulk import share one path.
export async function resolveNestId(input: { nestId?: string; nestName?: string }): Promise<string> {
  if (input.nestId) {
    const nest = await prisma.nest.findUnique({ where: { id: input.nestId } });
    if (!nest) throw new Error('Nest not found');
    return nest.id;
  }
  if (!input.nestName?.trim()) throw new Error('nestId or nestName is required');
  const existing = await prisma.nest.findFirst({ where: { name: input.nestName.trim() } });
  if (existing) return existing.id;
  const created = await prisma.nest.create({
    data: { uuid: uuidv4(), author: 'admin@local', name: input.nestName.trim(), description: input.nestName.trim() },
  });
  return created.id;
}

export async function createEggFromParsed(parsed: ParsedEgg, nestId: string) {
  return prisma.egg.create({
    data: {
      uuid: uuidv4(),
      nestId,
      author: parsed.author,
      name: parsed.name,
      description: parsed.description,
      dockerImage: parsed.dockerImage,
      configFiles: parsed.configFiles,
      configStartup: parsed.configStartup,
      configStop: parsed.configStop,
      configLogs: parsed.configLogs,
      startup: parsed.startup,
      scriptInstall: parsed.scriptInstall,
      scriptEntry: parsed.scriptEntry,
      scriptContainer: parsed.scriptContainer,
      logoUrl: parsed.logoUrl,
      variables: parsed.variables.length ? { create: parsed.variables } : undefined,
    },
    include: { variables: true, nest: true },
  });
}

// Exports back to the same PTDL_v2 shape — round-trips through any real
// Pterodactyl/Pelican panel, and through our own import above.
export function buildEggExportJson(egg: {
  name: string; author: string; description: string | null; dockerImage: string;
  configFiles: string; configStartup: string; configStop: string; configLogs: string;
  startup: string; scriptInstall: string | null; scriptEntry: string; scriptContainer: string;
  variables: Array<{ name: string; description: string | null; envVariable: string; defaultValue: string; userViewable: boolean; userEditable: boolean; rules: string }>;
}) {
  return {
    _comment: 'Exported from Kretase — https://kretase.com',
    meta: { version: 'PTDL_v2' },
    exported_at: new Date().toISOString(),
    name: egg.name,
    author: egg.author,
    description: egg.description || '',
    features: null,
    docker_images: { [egg.dockerImage]: egg.dockerImage },
    file_denylist: [],
    startup: egg.startup,
    config: {
      files: egg.configFiles,
      startup: egg.configStartup,
      logs: egg.configLogs,
      stop: egg.configStop,
    },
    scripts: {
      installation: {
        script: egg.scriptInstall || '',
        container: egg.scriptContainer,
        entrypoint: egg.scriptEntry,
      },
    },
    variables: egg.variables.map((v) => ({
      name: v.name,
      description: v.description || '',
      env_variable: v.envVariable,
      default_value: v.defaultValue,
      user_viewable: v.userViewable,
      user_editable: v.userEditable,
      rules: v.rules,
    })),
  };
}
