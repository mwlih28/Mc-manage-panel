import * as fs from 'fs';
import * as path from 'path';
import { gunzipSync } from 'zlib';
import { PNG } from 'pngjs';
import { readChunkNbt } from './anvil';
import { parseNbt, NbtValue } from './nbt';

// Unpacks Minecraft's "non-spanning" bit-packed long array format (used
// since 1.16 for both heightmaps and block-state palette indices): each
// entry is `bitsPerValue` wide, entries never straddle a 64-bit word, and
// leftover bits at the top of each word are unused padding.
function unpackLongArray(data: BigInt64Array, bitsPerValue: number, numEntries: number): number[] {
  const result = new Array<number>(numEntries).fill(0);
  if (bitsPerValue === 0) return result;
  const valuesPerLong = Math.floor(64 / bitsPerValue);
  const mask = (1n << BigInt(bitsPerValue)) - 1n;
  let entryIndex = 0;
  for (let li = 0; li < data.length && entryIndex < numEntries; li++) {
    let word = data[li];
    if (word < 0n) word += 1n << 64n;
    for (let vi = 0; vi < valuesPerLong && entryIndex < numEntries; vi++) {
      const shift = BigInt(vi * bitsPerValue);
      result[entryIndex++] = Number((word >> shift) & mask);
    }
  }
  return result;
}

function bitsForHeightmap(longArrLength: number): number {
  for (let bits = 1; bits <= 32; bits++) {
    const perLong = Math.floor(64 / bits);
    if (perLong === 0) continue;
    if (Math.ceil(256 / perLong) === longArrLength) return bits;
  }
  return 9;
}

interface DecodedSection {
  names: string[];
  indices: number[] | null; // null means the whole section is one uniform block (names[0])
}

function isAirLike(name: string): boolean {
  return name === 'minecraft:air' || name === 'minecraft:cave_air' || name === 'minecraft:void_air';
}

const EXACT_COLORS: Record<string, [number, number, number]> = {
  'minecraft:grass_block': [92, 148, 63],
  'minecraft:water': [63, 118, 228],
  'minecraft:lava': [217, 89, 26],
  'minecraft:sand': [219, 208, 154],
  'minecraft:red_sand': [190, 101, 40],
  'minecraft:sandstone': [216, 203, 155],
  'minecraft:ice': [151, 187, 240],
  'minecraft:packed_ice': [141, 180, 238],
  'minecraft:blue_ice': [116, 168, 235],
  'minecraft:snow': [248, 248, 250],
  'minecraft:snow_block': [248, 248, 250],
  'minecraft:powder_snow': [244, 244, 248],
  'minecraft:dirt': [134, 96, 67],
  'minecraft:coarse_dirt': [128, 92, 65],
  'minecraft:podzol': [101, 75, 40],
  'minecraft:mycelium': [111, 98, 105],
  'minecraft:clay': [161, 166, 176],
  'minecraft:gravel': [136, 130, 125],
  'minecraft:obsidian': [20, 16, 30],
  'minecraft:netherrack': [110, 53, 51],
  'minecraft:soul_sand': [82, 64, 51],
  'minecraft:soul_soil': [75, 59, 48],
  'minecraft:end_stone': [219, 219, 165],
  'minecraft:magma_block': [104, 55, 28],
  'minecraft:mud': [63, 61, 62],
  'minecraft:moss_block': [88, 122, 48],
};

function colorForBlock(fullName: string): [number, number, number] {
  const exact = EXACT_COLORS[fullName];
  if (exact) return exact;
  const name = fullName.replace('minecraft:', '');
  if (name.includes('leaves')) return [58, 95, 41];
  if (name.includes('log') || name.includes('wood') || name.includes('planks')) return [107, 80, 49];
  if (name.includes('terracotta')) return [151, 96, 71];
  if (name.includes('concrete')) return [180, 180, 185];
  if (name.includes('wool')) return [220, 220, 220];
  if (name.includes('basalt') || name.includes('blackstone')) return [58, 55, 63];
  if (name.includes('deepslate')) return [77, 77, 82];
  if (name.includes('calcite')) return [224, 223, 216];
  if (name.includes('tuff')) return [108, 109, 102];
  if (name.includes('andesite')) return [136, 136, 137];
  if (name.includes('diorite')) return [188, 188, 187];
  if (name.includes('granite')) return [149, 105, 86];
  if (name.includes('stone') || name.includes('cobblestone')) return [125, 125, 125];
  if (name.includes('ore')) return [140, 140, 140];
  return [120, 120, 120];
}

class ChunkBlockReader {
  private sectionsByY = new Map<number, Record<string, NbtValue>>();
  private cache = new Map<number, DecodedSection | null>();

  constructor(sections: NbtValue[]) {
    for (const s of sections) {
      const sec = s as Record<string, NbtValue>;
      this.sectionsByY.set(Number(sec.Y), sec);
    }
  }

  private decode(sectionY: number): DecodedSection | null {
    if (this.cache.has(sectionY)) return this.cache.get(sectionY)!;
    const section = this.sectionsByY.get(sectionY);
    const blockStates = section?.block_states as Record<string, NbtValue> | undefined;
    const palette = blockStates?.palette as Record<string, NbtValue>[] | undefined;
    if (!section || !blockStates || !palette || palette.length === 0) {
      this.cache.set(sectionY, null);
      return null;
    }
    const names = palette.map((p) => p.Name as string);
    let decoded: DecodedSection;
    const data = blockStates.data as BigInt64Array | undefined;
    if (names.length <= 1 || !data) {
      decoded = { names, indices: null };
    } else {
      const bits = Math.max(4, Math.ceil(Math.log2(names.length)));
      decoded = { names, indices: unpackLongArray(data, bits, 4096) };
    }
    this.cache.set(sectionY, decoded);
    return decoded;
  }

  getBlockName(localX: number, y: number, localZ: number): string | null {
    const sectionY = Math.floor(y / 16);
    const decoded = this.decode(sectionY);
    if (!decoded) return null;
    if (decoded.indices === null) return decoded.names[0] ?? null;
    const localY = y - sectionY * 16;
    const idx = localY * 256 + localZ * 16 + localX;
    const paletteIndex = decoded.indices[idx];
    return decoded.names[paletteIndex] ?? null;
  }
}

export interface WorldMapOptions {
  centerX?: number;
  centerZ?: number;
  radius?: number; // in blocks; output image is (radius*2) x (radius*2)
}

export interface WorldMapResult {
  png: Buffer;
  width: number;
  height: number;
  blockMinX: number;
  blockMinZ: number;
  chunksRendered: number;
}

const MAX_RADIUS = 1024;

// Reads the world's spawn point out of level.dat so the map can default to
// centering on the area players actually built in, rather than always 0,0.
export function getWorldSpawn(worldDir: string): { x: number; z: number } | null {
  const levelDatPath = path.join(worldDir, 'level.dat');
  if (!fs.existsSync(levelDatPath)) return null;
  try {
    const root = parseNbt(gunzipSync(fs.readFileSync(levelDatPath))).value as Record<string, NbtValue>;
    const data = root.Data as Record<string, NbtValue> | undefined;
    const x = data?.SpawnX;
    const z = data?.SpawnZ;
    if (typeof x !== 'number' || typeof z !== 'number') return null;
    return { x, z };
  } catch {
    return null;
  }
}

interface CacheEntry {
  mtimeMs: number;
  result: WorldMapResult;
}
const renderCache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 50;

// Avoids re-decoding potentially thousands of chunks on every request when
// nothing in the world has changed since the last render.
export function renderWorldMapCached(worldDir: string, opts: WorldMapOptions = {}): WorldMapResult {
  const regionDir = path.join(worldDir, 'region');
  const key = `${worldDir}|${opts.centerX ?? 0}|${opts.centerZ ?? 0}|${opts.radius ?? 512}`;

  let mtimeMs = 0;
  try {
    for (const f of fs.readdirSync(regionDir)) {
      const st = fs.statSync(path.join(regionDir, f));
      if (st.mtimeMs > mtimeMs) mtimeMs = st.mtimeMs;
    }
  } catch {
    // regionDir missing entirely — renderWorldMap will throw a clear error below.
  }

  const cached = renderCache.get(key);
  if (cached && cached.mtimeMs === mtimeMs) return cached.result;

  const result = renderWorldMap(worldDir, opts);
  if (renderCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = renderCache.keys().next().value;
    if (oldestKey !== undefined) renderCache.delete(oldestKey);
  }
  renderCache.set(key, { mtimeMs, result });
  return result;
}

export function renderWorldMap(worldDir: string, opts: WorldMapOptions = {}): WorldMapResult {
  const regionDir = path.join(worldDir, 'region');
  if (!fs.existsSync(regionDir)) {
    throw new Error('World has no region data yet (server may never have been started)');
  }

  const centerX = Math.trunc(opts.centerX ?? 0);
  const centerZ = Math.trunc(opts.centerZ ?? 0);
  const radius = Math.max(16, Math.min(Math.trunc(opts.radius ?? 512), MAX_RADIUS));
  const size = radius * 2;
  const minBlockX = centerX - radius;
  const minBlockZ = centerZ - radius;

  const png = new PNG({ width: size, height: size });
  png.data.fill(0);

  const minChunkX = Math.floor(minBlockX / 16);
  const maxChunkX = Math.floor((minBlockX + size - 1) / 16);
  const minChunkZ = Math.floor(minBlockZ / 16);
  const maxChunkZ = Math.floor((minBlockZ + size - 1) / 16);

  let chunksRendered = 0;

  for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
    for (let cx = minChunkX; cx <= maxChunkX; cx++) {
      const regionX = Math.floor(cx / 32);
      const regionZ = Math.floor(cz / 32);
      const regionFile = path.join(regionDir, `r.${regionX}.${regionZ}.mca`);
      if (!fs.existsSync(regionFile)) continue;

      let chunkRoot: NbtValue | null;
      try {
        chunkRoot = readChunkNbt(regionFile, cx, cz);
      } catch {
        continue;
      }
      if (!chunkRoot || typeof chunkRoot !== 'object') continue;
      const root = chunkRoot as Record<string, NbtValue>;
      const heightmaps = root.Heightmaps as Record<string, NbtValue> | undefined;
      const sections = root.sections as NbtValue[] | undefined;
      if (!heightmaps || !sections) continue;
      const hmRaw = (heightmaps.MOTION_BLOCKING ?? heightmaps.WORLD_SURFACE) as BigInt64Array | undefined;
      if (!hmRaw) continue;

      const minSectionY = Number(root.yPos ?? -4);
      const minBuildHeight = minSectionY * 16;
      const heights = unpackLongArray(hmRaw, bitsForHeightmap(hmRaw.length), 256);
      const reader = new ChunkBlockReader(sections);
      chunksRendered++;

      for (let lz = 0; lz < 16; lz++) {
        const blockZ = cz * 16 + lz;
        if (blockZ < minBlockZ || blockZ >= minBlockZ + size) continue;
        for (let lx = 0; lx < 16; lx++) {
          const blockX = cx * 16 + lx;
          if (blockX < minBlockX || blockX >= minBlockX + size) continue;

          const hmIndex = lz * 16 + lx;
          let sampleY = heights[hmIndex] + minBuildHeight - 1;
          let color: [number, number, number] | null = null;
          for (let attempt = 0; attempt < 6; attempt++) {
            const name = reader.getBlockName(lx, sampleY, lz);
            if (name && !isAirLike(name)) {
              color = colorForBlock(name);
              break;
            }
            sampleY--;
          }
          if (!color) continue;

          const px = blockX - minBlockX;
          const py = blockZ - minBlockZ;
          const idx = (size * py + px) << 2;
          png.data[idx] = color[0];
          png.data[idx + 1] = color[1];
          png.data[idx + 2] = color[2];
          png.data[idx + 3] = 255;
        }
      }
    }
  }

  return {
    png: PNG.sync.write(png),
    width: size,
    height: size,
    blockMinX: minBlockX,
    blockMinZ: minBlockZ,
    chunksRendered,
  };
}
