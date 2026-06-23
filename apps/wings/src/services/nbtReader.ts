import { gunzipSync } from 'zlib';
import fs from 'fs';

class NbtReader {
  private buf: Buffer;
  private pos = 0;
  constructor(buf: Buffer) { this.buf = buf; }

  readUByte() { return this.buf.readUInt8(this.pos++); }
  readByte() { return this.buf.readInt8(this.pos++); }
  readShort() { const v = this.buf.readInt16BE(this.pos); this.pos += 2; return v; }
  readInt() { const v = this.buf.readInt32BE(this.pos); this.pos += 4; return v; }
  readLong() { const v = this.buf.readBigInt64BE(this.pos); this.pos += 8; return Number(v); }
  readFloat() { const v = this.buf.readFloatBE(this.pos); this.pos += 4; return v; }
  readDouble() { const v = this.buf.readDoubleBE(this.pos); this.pos += 8; return v; }
  readString() { const len = this.buf.readUInt16BE(this.pos); this.pos += 2; const s = this.buf.toString('utf8', this.pos, this.pos + len); this.pos += len; return s; }

  readPayload(type: number): unknown {
    switch (type) {
      case 1: return this.readByte();
      case 2: return this.readShort();
      case 3: return this.readInt();
      case 4: return this.readLong();
      case 5: return this.readFloat();
      case 6: return this.readDouble();
      case 7: { const len = this.readInt(); const arr = this.buf.slice(this.pos, this.pos + len); this.pos += len; return arr; }
      case 8: return this.readString();
      case 9: return this.readList();
      case 10: return this.readCompound();
      case 11: { const len = this.readInt(); const arr: number[] = []; for (let i = 0; i < len; i++) arr.push(this.readInt()); return arr; }
      case 12: { const len = this.readInt(); const arr: number[] = []; for (let i = 0; i < len; i++) arr.push(this.readLong()); return arr; }
      default: throw new Error(`Unknown NBT type ${type} at pos ${this.pos}`);
    }
  }

  readList(): unknown[] {
    const elemType = this.readUByte();
    const len = this.readInt();
    const arr: unknown[] = [];
    for (let i = 0; i < len; i++) arr.push(elemType === 0 ? null : this.readPayload(elemType));
    return arr;
  }

  readCompound(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (;;) {
      const type = this.readUByte();
      if (type === 0) break;
      const name = this.readString();
      obj[name] = this.readPayload(type);
    }
    return obj;
  }

  readRoot() {
    const type = this.readUByte();
    if (type !== 10) throw new Error('NBT root must be compound');
    this.readString(); // root name (usually empty)
    return this.readCompound();
  }
}

export interface NbtItem {
  slot: number;
  id: string;
  count: number;
}

export function readPlayerDat(filePath: string): { inventory: NbtItem[]; enderChest: NbtItem[] } {
  if (!fs.existsSync(filePath)) return { inventory: [], enderChest: [] };
  const compressed = fs.readFileSync(filePath);
  const buf = gunzipSync(compressed);
  const root = new NbtReader(buf).readRoot();

  const parseItems = (list: unknown): NbtItem[] => {
    if (!Array.isArray(list)) return [];
    return (list as Array<Record<string, unknown>>)
      .filter(Boolean)
      .map(item => ({
        slot: (item.Slot as number) ?? 0,
        id: ((item.id as string) ?? '').replace('minecraft:', ''),
        count: (item.Count as number) ?? 1,
      }))
      .filter(item => item.id);
  };

  return {
    inventory: parseItems(root.Inventory),
    enderChest: parseItems(root.EnderItems),
  };
}
