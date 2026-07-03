import axios from 'axios';
import AdmZip from 'adm-zip';
import { ResolvedModpack, ResolvedMod, ResolvedOverride } from './modpackTypes';

const MODRINTH_API_BASE = 'https://api.modrinth.com/v2';
const USER_AGENT = 'Kretase-Panel/1.0 (+https://kretase.com)';

function client() {
  return axios.create({ baseURL: MODRINTH_API_BASE, timeout: 15000, headers: { 'User-Agent': USER_AGENT } });
}

export interface ModrinthModpackSummary {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  iconUrl: string | null;
  downloads: number;
}

export async function searchModpacks(query: string, offset = 0, limit = 20): Promise<{ results: ModrinthModpackSummary[]; totalHits: number }> {
  const { data } = await client().get('/search', {
    params: {
      query: query || undefined,
      facets: JSON.stringify([['project_type:modpack']]),
      offset, limit,
      index: query ? 'relevance' : 'downloads',
    },
  });
  interface RawHit {
    project_id: string; slug: string; title: string; description: string;
    icon_url: string | null; downloads: number;
  }
  const hits: RawHit[] = data.hits || [];
  return {
    results: hits.map(h => ({
      projectId: h.project_id, slug: h.slug, title: h.title, description: h.description,
      iconUrl: h.icon_url, downloads: h.downloads,
    })),
    totalHits: data.total_hits ?? hits.length,
  };
}

export interface ModrinthVersionSummary {
  id: string;
  versionNumber: string;
  name: string;
  gameVersions: string[];
  loaders: string[];
  datePublished: string;
}

export async function getModpackVersions(projectId: string): Promise<ModrinthVersionSummary[]> {
  const { data } = await client().get(`/project/${projectId}/version`);
  interface RawVersion {
    id: string; version_number: string; name: string;
    game_versions: string[]; loaders: string[]; date_published: string;
  }
  const versions: RawVersion[] = data || [];
  return versions.map(v => ({
    id: v.id, versionNumber: v.version_number, name: v.name,
    gameVersions: v.game_versions || [], loaders: v.loaders || [], datePublished: v.date_published,
  }));
}

interface MrpackIndex {
  dependencies: Record<string, string>;
  files: Array<{
    path: string;
    env?: { server?: string };
    downloads: string[];
    hashes?: Record<string, string>;
  }>;
}

// Downloads the version's .mrpack file and parses it into a loader-agnostic
// shape the install route can act on without knowing about Modrinth's file
// format. Overrides are read into memory as base64 (they're the small
// config/resourcepack files bundled in the pack, as opposed to the mod jars
// which stay as external URLs for Wings to fetch directly).
export async function resolveModpackInstall(versionId: string): Promise<ResolvedModpack> {
  const { data: version } = await client().get(`/version/${versionId}`);
  const primaryFile = (version.files || []).find((f: { primary: boolean }) => f.primary) || version.files?.[0];
  if (!primaryFile) throw new Error('This version has no downloadable file');

  const { data: archiveBuffer } = await axios.get<ArrayBuffer>(primaryFile.url, {
    responseType: 'arraybuffer', timeout: 120000, maxContentLength: 500 * 1024 * 1024,
    headers: { 'User-Agent': USER_AGENT },
  });

  const zip = new AdmZip(Buffer.from(archiveBuffer));
  const indexEntry = zip.getEntry('modrinth.index.json');
  if (!indexEntry) throw new Error('Not a valid .mrpack file (missing modrinth.index.json)');
  const index: MrpackIndex = JSON.parse(indexEntry.getData().toString('utf8'));

  const mods: ResolvedMod[] = [];
  for (const file of index.files) {
    if (file.env?.server === 'unsupported') continue; // client-only mod
    const url = file.downloads[0];
    if (!url) continue;
    mods.push({ url, path: file.path });
  }

  const overrides: ResolvedOverride[] = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const prefix = entry.entryName.startsWith('server-overrides/') ? 'server-overrides/'
      : entry.entryName.startsWith('overrides/') ? 'overrides/' : null;
    if (!prefix) continue;
    overrides.push({ path: entry.entryName.slice(prefix.length), contentBase64: entry.getData().toString('base64') });
  }

  const loaderKey = Object.keys(index.dependencies).find(k => k !== 'minecraft');
  const loaderType = loaderKey === 'fabric-loader' ? 'fabric'
    : loaderKey === 'quilt-loader' ? 'quilt'
    : loaderKey === 'forge' ? 'forge'
    : loaderKey === 'neoforge' ? 'neoforge'
    : 'unknown';

  return {
    mods, overrides,
    loader: {
      type: loaderType,
      minecraftVersion: index.dependencies.minecraft,
      loaderVersion: loaderKey ? index.dependencies[loaderKey] : undefined,
    },
  };
}

export interface ModrinthFileMatch {
  projectId: string;
  projectTitle: string;
  iconUrl: string | null;
  versionId: string;
  versionNumber: string;
}

// Matches installed jars to Modrinth projects by SHA1 — works regardless
// of filename, which is what makes it useful for jars that weren't
// installed through this panel (manually uploaded, or predating the
// per-install manifest this panel writes for its own installs).
export async function matchFilesBySha1(hashes: string[]): Promise<Map<string, ModrinthFileMatch>> {
  const result = new Map<string, ModrinthFileMatch>();
  if (hashes.length === 0) return result;

  const { data } = await client().post('/version_files', { hashes, algorithm: 'sha1' });
  interface RawVersionFile {
    project_id: string; id: string; version_number: string;
    files: { hashes: { sha1: string } }[];
  }
  const versionsByHash = data as Record<string, RawVersionFile>;
  const projectIds = [...new Set(Object.values(versionsByHash).map((v) => v.project_id))];
  if (projectIds.length === 0) return result;

  const { data: projects } = await client().get('/projects', { params: { ids: JSON.stringify(projectIds) } });
  interface RawProject { id: string; title: string; icon_url: string | null }
  const projectById = new Map<string, RawProject>((projects as RawProject[]).map((p) => [p.id, p]));

  for (const [hash, version] of Object.entries(versionsByHash)) {
    const project = projectById.get(version.project_id);
    result.set(hash, {
      projectId: version.project_id,
      projectTitle: project?.title || version.project_id,
      iconUrl: project?.icon_url || null,
      versionId: version.id,
      versionNumber: version.version_number,
    });
  }
  return result;
}
