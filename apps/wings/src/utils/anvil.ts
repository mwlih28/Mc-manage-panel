import * as fs from 'fs';
import * as zlib from 'zlib';
import { parseNbt, NbtValue } from './nbt';

const SECTOR_SIZE = 4096;
const REGION_CHUNKS = 32; // a region file is a 32x32 grid of chunks

export interface ChunkLocation {
  x: number; // chunk x within region (0-31)
  z: number; // chunk z within region (0-31)
}

// Reads a single chunk's root NBT compound out of a .mca region file, or
// null if that chunk was never generated (common at world edges).
export function readChunkNbt(regionFilePath: string, chunkX: number, chunkZ: number): NbtValue | null {
  const fd = fs.openSync(regionFilePath, 'r');
  try {
    const localX = ((chunkX % REGION_CHUNKS) + REGION_CHUNKS) % REGION_CHUNKS;
    const localZ = ((chunkZ % REGION_CHUNKS) + REGION_CHUNKS) % REGION_CHUNKS;
    const headerIndex = localX + localZ * REGION_CHUNKS;

    const entry = Buffer.alloc(4);
    fs.readSync(fd, entry, 0, 4, headerIndex * 4);
    const sectorOffset = (entry[0] << 16) | (entry[1] << 8) | entry[2];
    const sectorCount = entry[3];
    if (sectorOffset === 0 && sectorCount === 0) return null; // chunk not generated

    const lenBuf = Buffer.alloc(5);
    fs.readSync(fd, lenBuf, 0, 5, sectorOffset * SECTOR_SIZE);
    const length = lenBuf.readUInt32BE(0);
    const compressionType = lenBuf[4];
    if (length === 0) return null;

    const dataBuf = Buffer.alloc(length - 1);
    fs.readSync(fd, dataBuf, 0, length - 1, sectorOffset * SECTOR_SIZE + 5);

    let decompressed: Buffer;
    if (compressionType === 1) {
      decompressed = zlib.gunzipSync(dataBuf);
    } else if (compressionType === 2) {
      decompressed = zlib.inflateSync(dataBuf);
    } else if (compressionType === 3) {
      decompressed = dataBuf;
    } else {
      // Type 127 (external file, extremely rare) is not supported.
      return null;
    }

    return parseNbt(decompressed).value;
  } finally {
    fs.closeSync(fd);
  }
}

// Parses "r.<x>.<z>.mca" into its integer region coordinates.
export function parseRegionFileName(fileName: string): { x: number; z: number } | null {
  const match = fileName.match(/^r\.(-?\d+)\.(-?\d+)\.mca$/);
  if (!match) return null;
  return { x: parseInt(match[1], 10), z: parseInt(match[2], 10) };
}
