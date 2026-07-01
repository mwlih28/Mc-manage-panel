import axios from 'axios';
import { prisma } from '../utils/prisma';

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
