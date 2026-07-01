"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCurseForgeConfigured = isCurseForgeConfigured;
exports.searchWorlds = searchWorlds;
exports.getWorldFiles = getWorldFiles;
const axios_1 = __importDefault(require("axios"));
const prisma_1 = require("../utils/prisma");
const CF_API_BASE = 'https://api.curseforge.com/v1';
async function getApiKey() {
    const row = await prisma_1.prisma.setting.findUnique({ where: { key: 'curseforge.apiKey' } });
    return row?.value || null;
}
function client(apiKey) {
    return axios_1.default.create({
        baseURL: CF_API_BASE,
        timeout: 15000,
        headers: { 'x-api-key': apiKey, Accept: 'application/json' },
    });
}
// CurseForge's numeric gameId/classId aren't documented as stable public
// constants we could safely hardcode, so they're discovered once per process
// via name lookup and cached in memory for the life of the process.
let cachedGameId = null;
let cachedWorldsClassId = null;
async function resolveMinecraftGameId(apiKey) {
    if (cachedGameId)
        return cachedGameId;
    const { data } = await client(apiKey).get('/games', { params: { pageSize: 50 } });
    const games = data.data || [];
    const mc = games.find(g => g.slug === 'minecraft' || g.name?.toLowerCase() === 'minecraft');
    if (!mc)
        throw new Error('Could not resolve Minecraft game ID from CurseForge');
    cachedGameId = mc.id;
    return mc.id;
}
async function resolveWorldsClassId(apiKey, gameId) {
    if (cachedWorldsClassId)
        return cachedWorldsClassId;
    const { data } = await client(apiKey).get('/categories', { params: { gameId } });
    const categories = data.data || [];
    const worlds = categories.find(c => c.isClass && (c.slug === 'worlds' || c.name?.toLowerCase() === 'worlds'));
    if (!worlds)
        throw new Error('Could not resolve Worlds category from CurseForge');
    cachedWorldsClassId = worlds.id;
    return worlds.id;
}
async function isCurseForgeConfigured() {
    return !!(await getApiKey());
}
async function searchWorlds(query, index = 0, pageSize = 20) {
    const apiKey = await getApiKey();
    if (!apiKey)
        throw new Error('CurseForge API key not configured');
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
    const mods = data.data || [];
    const results = mods.map(m => ({
        id: m.id, name: m.name, summary: m.summary,
        logoUrl: m.logo?.thumbnailUrl || null,
        downloadCount: m.downloadCount,
        websiteUrl: m.links?.websiteUrl || '',
    }));
    return { results, totalCount: data.pagination?.totalCount ?? results.length };
}
async function getWorldFiles(modId) {
    const apiKey = await getApiKey();
    if (!apiKey)
        throw new Error('CurseForge API key not configured');
    const { data } = await client(apiKey).get(`/mods/${modId}/files`, { params: { pageSize: 50 } });
    const files = data.data || [];
    return files.map(f => ({
        id: f.id, fileName: f.fileName, displayName: f.displayName, fileDate: f.fileDate,
        fileLength: f.fileLength, downloadUrl: f.downloadUrl, gameVersions: f.gameVersions || [],
    }));
}
//# sourceMappingURL=curseforgeApi.js.map