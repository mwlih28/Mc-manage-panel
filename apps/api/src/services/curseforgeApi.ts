import axios from 'axios';
import AdmZip from 'adm-zip';
import { prisma } from '../utils/prisma';
import { ResolvedModpack, ResolvedMod, ResolvedOverride, ModLoaderType } from './modpackTypes';

const CF_API_BASE = 'https://api.curseforge.com/v1';

async function getApiKey(): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: 'curseforge.apiKey' } });
  return row?.value || null;
}

function client(apiKey: string) {
  return axios.create({
    baseURL: CF_API_BASE,
    timeout: 15000,
    headers: { 'x-api-key': apiKey, Accept: 'application/json' },
  });
}

// CurseForge's numeric gameId/classId aren't documented as stable public
// constants we could safely hardcode, so they're discovered once per process
// via name lookup and cached in memory for the life of the process.
let cachedGameId: number | null = null;
let cachedWorldsClassId: number | null = null;
let cachedModpacksClassId: number | null = null;

async function resolveMinecraftGameId(apiKey: string): Promise<number> {
  if (cachedGameId) return cachedGameId;
  const { data } = await client(apiKey).get('/games', { params: { pageSize: 50 } });
  const games: Array<{ id: number; name: string; slug: string }> = data.data || [];
  const mc = games.find(g => g.slug === 'minecraft' || g.name?.toLowerCase() === 'minecraft');
  if (!mc) throw new Error('Could not resolve Minecraft game ID from CurseForge');
  cachedGameId = mc.id;
  return mc.id;
}

async function resolveWorldsClassId(apiKey: string, gameId: number): Promise<number> {
  if (cachedWorldsClassId) return cachedWorldsClassId;
  const { data } = await client(apiKey).get('/categories', { params: { gameId } });
  const categories: Array<{ id: number; classId: number | null; isClass: boolean; name: string; slug: string }> = data.data || [];
  const worlds = categories.find(c => c.isClass && (c.slug === 'worlds' || c.name?.toLowerCase() === 'worlds'));
  if (!worlds) throw new Error('Could not resolve Worlds category from CurseForge');
  cachedWorldsClassId = worlds.id;
  return worlds.id;
}

async function resolveModpacksClassId(apiKey: string, gameId: number): Promise<number> {
  if (cachedModpacksClassId) return cachedModpacksClassId;
  const { data } = await client(apiKey).get('/categories', { params: { gameId } });
  const categories: Array<{ id: number; classId: number | null; isClass: boolean; name: string; slug: string }> = data.data || [];
  const modpacks = categories.find(c => c.isClass && (c.slug === 'modpacks' || c.name?.toLowerCase() === 'modpacks'));
  if (!modpacks) throw new Error('Could not resolve Modpacks category from CurseForge');
  cachedModpacksClassId = modpacks.id;
  return modpacks.id;
}

export interface CurseForgeWorldSummary {
  id: number;
  name: string;
  summary: string;
  logoUrl: string | null;
  downloadCount: number;
  websiteUrl: string;
}

export async function isCurseForgeConfigured(): Promise<boolean> {
  return !!(await getApiKey());
}

export async function searchWorlds(query: string, index = 0, pageSize = 20): Promise<{ results: CurseForgeWorldSummary[]; totalCount: number }> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('CurseForge API key not configured');

  const gameId = await resolveMinecraftGameId(apiKey);
  const classId = await resolveWorldsClassId(apiKey, gameId);

  const { data } = await client(apiKey).get('/mods/search', {
    params: {
      gameId, classId,
      searchFilter: query || undefined,
      sortField: query ? 2 : 6, // 2=Popularity when searching, 6=TotalDownloads when browsing
      sortOrder: 'desc',
      index, pageSize,
    },
  });

  interface RawMod {
    id: number; name: string; summary: string; downloadCount: number;
    links?: { websiteUrl?: string }; logo?: { thumbnailUrl?: string } | null;
  }
  const mods: RawMod[] = data.data || [];
  const results: CurseForgeWorldSummary[] = mods.map(m => ({
    id: m.id, name: m.name, summary: m.summary,
    logoUrl: m.logo?.thumbnailUrl || null,
    downloadCount: m.downloadCount,
    websiteUrl: m.links?.websiteUrl || '',
  }));
  return { results, totalCount: data.pagination?.totalCount ?? results.length };
}

export interface CurseForgeWorldFile {
  id: number;
  fileName: string;
  displayName: string;
  fileDate: string;
  fileLength: number;
  downloadUrl: string | null;
  gameVersions: string[];
}

export async function getWorldFiles(modId: number): Promise<CurseForgeWorldFile[]> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('CurseForge API key not configured');

  const { data } = await client(apiKey).get(`/mods/${modId}/files`, { params: { pageSize: 50 } });
  interface RawFile {
    id: number; fileName: string; displayName: string; fileDate: string;
    fileLength: number; downloadUrl: string | null; gameVersions: string[];
  }
  const files: RawFile[] = data.data || [];
  return files.map(f => ({
    id: f.id, fileName: f.fileName, displayName: f.displayName, fileDate: f.fileDate,
    fileLength: f.fileLength, downloadUrl: f.downloadUrl, gameVersions: f.gameVersions || [],
  }));
}

export type CurseForgeModpackSummary = CurseForgeWorldSummary;
export type CurseForgeModpackFile = CurseForgeWorldFile;

export async function searchModpacks(query: string, index = 0, pageSize = 20): Promise<{ results: CurseForgeModpackSummary[]; totalCount: number }> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('CurseForge API key not configured');

  const gameId = await resolveMinecraftGameId(apiKey);
  const classId = await resolveModpacksClassId(apiKey, gameId);

  const { data } = await client(apiKey).get('/mods/search', {
    params: {
      gameId, classId,
      searchFilter: query || undefined,
      sortField: query ? 2 : 6,
      sortOrder: 'desc',
      index, pageSize,
    },
  });

  interface RawMod {
    id: number; name: string; summary: string; downloadCount: number;
    links?: { websiteUrl?: string }; logo?: { thumbnailUrl?: string } | null;
  }
  const mods: RawMod[] = data.data || [];
  const results: CurseForgeModpackSummary[] = mods.map(m => ({
    id: m.id, name: m.name, summary: m.summary,
    logoUrl: m.logo?.thumbnailUrl || null,
    downloadCount: m.downloadCount,
    websiteUrl: m.links?.websiteUrl || '',
  }));
  return { results, totalCount: data.pagination?.totalCount ?? results.length };
}

export async function getModpackFiles(modId: number): Promise<CurseForgeModpackFile[]> {
  return getWorldFiles(modId);
}

interface CurseForgeManifest {
  minecraft: { version: string; modLoaders: Array<{ id: string; primary: boolean }> };
  files: Array<{ projectID: number; fileID: number; required: boolean }>;
}

// Downloads a modpack's file (a zip containing manifest.json + overrides/),
// resolves each referenced mod's real download URL via CurseForge's bulk
// files endpoint (the manifest only carries project/file IDs), and returns
// the same loader-agnostic shape the Modrinth resolver produces.
export async function resolveModpackInstall(modId: number, fileId: number): Promise<ResolvedModpack> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('CurseForge API key not configured');

  const { data: fileInfo } = await client(apiKey).get(`/mods/${modId}/files/${fileId}/download-url`).catch(() => ({ data: { data: null } }));
  const downloadUrl: string | null = fileInfo?.data || null;
  if (!downloadUrl) throw new Error('This file has no direct download link (author disabled third-party distribution)');

  const { data: archiveBuffer } = await axios.get<ArrayBuffer>(downloadUrl, {
    responseType: 'arraybuffer', timeout: 120000, maxContentLength: 500 * 1024 * 1024,
  });

  const zip = new AdmZip(Buffer.from(archiveBuffer));
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) throw new Error('Not a valid CurseForge modpack file (missing manifest.json)');
  const manifest: CurseForgeManifest = JSON.parse(manifestEntry.getData().toString('utf8'));

  const requiredFiles = manifest.files.filter(f => f.required);
  const mods: ResolvedMod[] = [];
  if (requiredFiles.length > 0) {
    const { data: bulk } = await client(apiKey).post('/mods/files', { fileIds: requiredFiles.map(f => f.fileID) });
    interface BulkFile { id: number; fileName: string; downloadUrl: string | null }
    const files: BulkFile[] = bulk.data || [];
    for (const f of files) {
      if (!f.downloadUrl) continue; // author disabled distribution for this mod — skip, can't auto-install
      mods.push({ url: f.downloadUrl, path: `mods/${f.fileName}` });
    }
  }

  const overrides: ResolvedOverride[] = [];
  const overridesPrefix = 'overrides/';
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith(overridesPrefix)) continue;
    overrides.push({ path: entry.entryName.slice(overridesPrefix.length), contentBase64: entry.getData().toString('base64') });
  }

  const primaryLoader = manifest.minecraft.modLoaders.find(l => l.primary) || manifest.minecraft.modLoaders[0];
  const loaderType: ModLoaderType = primaryLoader?.id.startsWith('fabric-') ? 'fabric'
    : primaryLoader?.id.startsWith('quilt-') ? 'quilt'
    : primaryLoader?.id.startsWith('forge-') ? 'forge'
    : primaryLoader?.id.startsWith('neoforge-') ? 'neoforge'
    : 'unknown';
  const loaderVersion = primaryLoader?.id.replace(/^(fabric|quilt|forge|neoforge)-/, '');

  return {
    mods, overrides,
    loader: { type: loaderType, minecraftVersion: manifest.minecraft.version, loaderVersion },
  };
}

export interface CurseForgeFileMatch {
  modId: number;
  modName: string;
  iconUrl: string | null;
  fileId: number;
  fileName: string;
  latestFileId: number;
  latestFileName: string;
  latestFileDate: string;
}

// Matches installed jars to CurseForge mods by their fingerprint (a
// murmur2 hash of the file with whitespace bytes stripped — see
// apps/wings/src/utils/murmur2.ts for why), then resolves the newest file
// for each matched mod so the caller can tell if an update exists.
export async function matchFilesByFingerprint(fingerprints: number[]): Promise<Map<number, CurseForgeFileMatch>> {
  const result = new Map<number, CurseForgeFileMatch>();
  const apiKey = await getApiKey();
  if (!apiKey || fingerprints.length === 0) return result;

  const { data } = await client(apiKey).post('/fingerprints', { fingerprints });
  interface ExactMatch {
    id: number; file: { id: number; fileName: string; modId: number };
  }
  const matches: ExactMatch[] = data.data?.exactMatches || [];
  if (matches.length === 0) return result;

  const modIds = [...new Set(matches.map((m) => m.file.modId))];
  const { data: modsData } = await client(apiKey).post('/mods', { modIds });
  interface RawMod {
    id: number; name: string; logo?: { thumbnailUrl?: string } | null;
    latestFiles: { id: number; fileName: string; fileDate: string }[];
  }
  const modById = new Map<number, RawMod>((modsData.data as RawMod[]).map((m) => [m.id, m]));

  for (const match of matches) {
    const mod = modById.get(match.file.modId);
    if (!mod) continue;
    const latest = [...(mod.latestFiles || [])].sort((a, b) => (a.fileDate < b.fileDate ? 1 : -1))[0];
    result.set(match.id, {
      modId: mod.id,
      modName: mod.name,
      iconUrl: mod.logo?.thumbnailUrl || null,
      fileId: match.file.id,
      fileName: match.file.fileName,
      latestFileId: latest?.id ?? match.file.id,
      latestFileName: latest?.fileName ?? match.file.fileName,
      latestFileDate: latest?.fileDate ?? '',
    });
  }
  return result;
}
