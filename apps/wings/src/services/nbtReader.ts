import { gunzipSync, gzipSync } from 'zlib';
import fs from 'fs';

// ── Typed NBT tag system ─────────────────────────────────────────────────────

type NbtTagType = 1|2|3|4|5|6|7|8|9|10|11|12;
interface NbtByte    { t: 1;  v: number }
interface NbtShort   { t: 2;  v: number }
interface NbtInt     { t: 3;  v: number }
interface NbtLong    { t: 4;  v: bigint }
interface NbtFloat   { t: 5;  v: number }
interface NbtDouble  { t: 6;  v: number }
interface NbtByteArr { t: 7;  v: Buffer }
interface NbtString  { t: 8;  v: string }
interface NbtList    { t: 9;  v: NbtAny[]; et: NbtTagType }
interface NbtCompound{ t: 10; v: Map<string, NbtAny> }
interface NbtIntArr  { t: 11; v: number[] }
interface NbtLongArr { t: 12; v: bigint[] }
type NbtAny =
  | NbtByte | NbtShort | NbtInt | NbtLong | NbtFloat | NbtDouble
  | NbtByteArr | NbtString | NbtList | NbtCompound | NbtIntArr | NbtLongArr;

// ── Typed reader ─────────────────────────────────────────────────────────────

class TypedReader {
  private buf: Buffer;
  private pos = 0;
  constructor(buf: Buffer) { this.buf = buf; }

  rU8()  { return this.buf.readUInt8(this.pos++); }
  rI8()  { return this.buf.readInt8(this.pos++); }
  rI16() { const v = this.buf.readInt16BE(this.pos); this.pos += 2; return v; }
  rI32() { const v = this.buf.readInt32BE(this.pos); this.pos += 4; return v; }
  rI64() { const v = this.buf.readBigInt64BE(this.pos); this.pos += 8; return v; }
  rF32() { const v = this.buf.readFloatBE(this.pos); this.pos += 4; return v; }
  rF64() { const v = this.buf.readDoubleBE(this.pos); this.pos += 8; return v; }
  rStr() {
    const len = this.buf.readUInt16BE(this.pos); this.pos += 2;
    const s = this.buf.toString('utf8', this.pos, this.pos + len); this.pos += len; return s;
  }

  rTag(type: number): NbtAny {
    switch (type) {
      case 1:  return { t: 1, v: this.rI8() };
      case 2:  return { t: 2, v: this.rI16() };
      case 3:  return { t: 3, v: this.rI32() };
      case 4:  return { t: 4, v: this.rI64() };
      case 5:  return { t: 5, v: this.rF32() };
      case 6:  return { t: 6, v: this.rF64() };
      case 7:  { const n = this.rI32(); const v = this.buf.slice(this.pos, this.pos+n); this.pos += n; return { t: 7, v }; }
      case 8:  return { t: 8, v: this.rStr() };
      case 9:  return this.rList();
      case 10: return this.rCompound();
      case 11: { const n = this.rI32(); const v: number[] = []; for (let i=0;i<n;i++) v.push(this.rI32()); return { t:11, v }; }
      case 12: { const n = this.rI32(); const v: bigint[] = []; for (let i=0;i<n;i++) v.push(this.rI64()); return { t:12, v }; }
      default: throw new Error(`Unknown NBT type ${type} at ${this.pos}`);
    }
  }

  rList(): NbtList {
    const et = this.rU8() as NbtTagType;
    const n = this.rI32();
    const v: NbtAny[] = [];
    for (let i = 0; i < n; i++) v.push((et as number) === 0 ? { t: 10, v: new Map() } as NbtCompound : this.rTag(et));
    return { t: 9, v, et: et || 10 };
  }

  rCompound(): NbtCompound {
    const map = new Map<string, NbtAny>();
    for (;;) {
      const type = this.rU8(); if (type === 0) break;
      const name = this.rStr();
      map.set(name, this.rTag(type));
    }
    return { t: 10, v: map };
  }

  readRoot(): NbtCompound {
    const type = this.rU8();
    if (type !== 10) throw new Error('NBT root must be TAG_Compound');
    this.rStr();
    return this.rCompound();
  }
}

// ── Typed writer ─────────────────────────────────────────────────────────────

class TypedWriter {
  private parts: Buffer[] = [];

  wU8(v: number)  { const b = Buffer.alloc(1); b.writeUInt8(v);    this.parts.push(b); }
  wI8(v: number)  { const b = Buffer.alloc(1); b.writeInt8(v);     this.parts.push(b); }
  wI16(v: number) { const b = Buffer.alloc(2); b.writeInt16BE(v);  this.parts.push(b); }
  wI32(v: number) { const b = Buffer.alloc(4); b.writeInt32BE(v);  this.parts.push(b); }
  wI64(v: bigint) { const b = Buffer.alloc(8); b.writeBigInt64BE(v); this.parts.push(b); }
  wF32(v: number) { const b = Buffer.alloc(4); b.writeFloatBE(v);  this.parts.push(b); }
  wF64(v: number) { const b = Buffer.alloc(8); b.writeDoubleBE(v); this.parts.push(b); }

  wStr(s: string) {
    const enc = Buffer.from(s, 'utf8');
    this.wI16(enc.length);
    this.parts.push(enc);
  }

  wTag(tag: NbtAny): void {
    switch (tag.t) {
      case 1:  this.wI8(tag.v); break;
      case 2:  this.wI16(tag.v); break;
      case 3:  this.wI32(tag.v); break;
      case 4:  this.wI64(tag.v); break;
      case 5:  this.wF32(tag.v); break;
      case 6:  this.wF64(tag.v); break;
      case 7:  this.wI32(tag.v.length); this.parts.push(tag.v); break;
      case 8:  this.wStr(tag.v); break;
      case 9: {
        const et: NbtTagType = tag.v.length > 0 ? tag.v[0].t : tag.et;
        this.wU8(tag.v.length > 0 ? et : 0);
        this.wI32(tag.v.length);
        for (const item of tag.v) this.wTag(item);
        break;
      }
      case 10: {
        for (const [name, child] of tag.v) {
          this.wU8(child.t);
          this.wStr(name);
          this.wTag(child);
        }
        this.wU8(0);
        break;
      }
      case 11: this.wI32(tag.v.length); for (const v of tag.v) this.wI32(v); break;
      case 12: this.wI32(tag.v.length); for (const v of tag.v) this.wI64(v); break;
    }
  }

  writeRoot(compound: NbtCompound, name = ''): void {
    this.wU8(10);
    this.wStr(name);
    this.wTag(compound);
  }

  toBuffer(): Buffer { return Buffer.concat(this.parts); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Minecraft stores worn armour and the off-hand item in the same `Inventory`
// list as the rest of the items, but at out-of-band slot numbers: boots=100,
// leggings=101, chestplate=102, helmet=103, off-hand=-106. The panel UI
// addresses those as 36 (boots) → 39 (helmet) and 40 (off-hand), so remap on
// read. Main inventory / hotbar (0-35) and ender-chest slots (0-26) are left
// untouched.
const RAW_TO_DISPLAY: Record<number, number> = { 100: 36, 101: 37, 102: 38, 103: 39, [-106]: 40 };
const DISPLAY_TO_RAW: Record<number, number> = { 36: 100, 37: 101, 38: 102, 39: 103, 40: -106 };

function parseItemList(list: NbtAny | undefined, remapArmor = false): NbtItem[] {
  if (!list || list.t !== 9) return [];
  return (list as NbtList).v
    .filter((item): item is NbtCompound => item.t === 10)
    .map(item => {
      const slotTag  = item.v.get('Slot');
      const idTag    = item.v.get('id');
      const countTag = item.v.get('Count');
      const rawSlot  = slotTag && (slotTag.t === 1 || slotTag.t === 3) ? (slotTag.v as number) : 0;
      const slot     = remapArmor && rawSlot in RAW_TO_DISPLAY ? RAW_TO_DISPLAY[rawSlot] : Math.abs(rawSlot);
      return {
        slot,
        id:    idTag    &&  idTag.t    === 8                       ? (idTag.v    as string).replace('minecraft:', '') : '',
        count: countTag && (countTag.t === 1 || countTag.t === 3) ? Math.abs(countTag.v as number) : 1,
      };
    })
    .filter(item => item.id);
}

// ── Public exports ─────────────────────────────────────────────────────────────

export interface NbtItem {
  slot: number;
  id: string;
  count: number;
}

export interface PlayerLocation {
  x: number;
  y: number;
  z: number;
  dimension: string;
  health: number;
  xpLevel: number;
}

export interface PlayerStats {
  playTimeTicks: number;
  deaths: number;
  walkOneCm: number;
  sprintOneCm: number;
  jumps: number;
  playerKills: number;
  mobKills: number;
  blocksMinedTotal: number;
}

export function readPlayerDat(filePath: string): { inventory: NbtItem[]; enderChest: NbtItem[] } {
  if (!fs.existsSync(filePath)) return { inventory: [], enderChest: [] };
  try {
    const root = new TypedReader(gunzipSync(fs.readFileSync(filePath))).readRoot();
    return {
      inventory:  parseItemList(root.v.get('Inventory'), true),
      enderChest: parseItemList(root.v.get('EnderItems')),
    };
  } catch { return { inventory: [], enderChest: [] }; }
}

export function readPlayerLocation(filePath: string): PlayerLocation | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const root = new TypedReader(gunzipSync(fs.readFileSync(filePath))).readRoot();
    const posTag = root.v.get('Pos');
    let x = 0, y = 0, z = 0;
    if (posTag && posTag.t === 9 && (posTag as NbtList).v.length >= 3) {
      x = Number((posTag as NbtList).v[0].v); y = Number((posTag as NbtList).v[1].v); z = Number((posTag as NbtList).v[2].v);
    }
    const dimTag = root.v.get('Dimension');
    const dimension = dimTag && dimTag.t === 8 ? (dimTag.v as string).replace('minecraft:', '') : 'overworld';
    const hpTag = root.v.get('Health');
    const health = hpTag && (hpTag.t === 5 || hpTag.t === 6) ? Math.round(hpTag.v as number) : 0;
    const xpTag = root.v.get('XpLevel');
    const xpLevel = xpTag && xpTag.t === 3 ? xpTag.v as number : 0;
    return { x: Math.round(x), y: Math.round(y), z: Math.round(z), dimension, health, xpLevel };
  } catch { return null; }
}

export function readPlayerStats(statsFilePath: string): PlayerStats {
  const empty: PlayerStats = { playTimeTicks: 0, deaths: 0, walkOneCm: 0, sprintOneCm: 0, jumps: 0, playerKills: 0, mobKills: 0, blocksMinedTotal: 0 };
  if (!fs.existsSync(statsFilePath)) return empty;
  try {
    const data = JSON.parse(fs.readFileSync(statsFilePath, 'utf8'));
    const custom: Record<string, number> = data?.stats?.['minecraft:custom'] ?? {};
    const mined:  Record<string, number> = data?.stats?.['minecraft:mined']  ?? {};
    return {
      playTimeTicks:     custom['minecraft:play_time'] ?? custom['minecraft:total_world_time'] ?? 0,
      deaths:            custom['minecraft:deaths']       ?? 0,
      walkOneCm:         custom['minecraft:walk_one_cm']  ?? 0,
      sprintOneCm:       custom['minecraft:sprint_one_cm'] ?? 0,
      jumps:             custom['minecraft:jump']         ?? 0,
      playerKills:       custom['minecraft:player_kills'] ?? 0,
      mobKills:          custom['minecraft:mob_kills']    ?? 0,
      blocksMinedTotal:  Object.values(mined).reduce((a, v) => a + v, 0),
    };
  } catch { return empty; }
}

export function removeInventoryItem(filePath: string, slot: number, fromEnderChest = false): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const root = new TypedReader(gunzipSync(fs.readFileSync(filePath))).readRoot();
    const key = fromEnderChest ? 'EnderItems' : 'Inventory';
    const list = root.v.get(key);
    if (!list || list.t !== 9) return false;
    const l = list as NbtList;
    const before = l.v.length;
    // The UI addresses armour/off-hand as 36-40; translate back to the raw
    // NBT slot (100-103 / -106) so the right stored entry is matched.
    const rawSlot = !fromEnderChest && slot in DISPLAY_TO_RAW ? DISPLAY_TO_RAW[slot] : slot;
    l.v = l.v.filter(item => {
      if (item.t !== 10) return true;
      const s = (item as NbtCompound).v.get('Slot');
      if (!s) return true;
      const stored = Number(s.v);
      return stored !== rawSlot && Math.abs(stored) !== slot;
    });
    if (l.v.length === before) return false;
    const writer = new TypedWriter();
    writer.writeRoot(root);
    fs.writeFileSync(filePath, gzipSync(writer.toBuffer()));
    return true;
  } catch { return false; }
}
