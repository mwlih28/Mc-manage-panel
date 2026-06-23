"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPlayerDat = readPlayerDat;
exports.readPlayerLocation = readPlayerLocation;
exports.readPlayerStats = readPlayerStats;
exports.removeInventoryItem = removeInventoryItem;
const zlib_1 = require("zlib");
const fs_1 = __importDefault(require("fs"));
// ── Typed reader ─────────────────────────────────────────────────────────────
class TypedReader {
    constructor(buf) {
        this.pos = 0;
        this.buf = buf;
    }
    rU8() { return this.buf.readUInt8(this.pos++); }
    rI8() { return this.buf.readInt8(this.pos++); }
    rI16() { const v = this.buf.readInt16BE(this.pos); this.pos += 2; return v; }
    rI32() { const v = this.buf.readInt32BE(this.pos); this.pos += 4; return v; }
    rI64() { const v = this.buf.readBigInt64BE(this.pos); this.pos += 8; return v; }
    rF32() { const v = this.buf.readFloatBE(this.pos); this.pos += 4; return v; }
    rF64() { const v = this.buf.readDoubleBE(this.pos); this.pos += 8; return v; }
    rStr() {
        const len = this.buf.readUInt16BE(this.pos);
        this.pos += 2;
        const s = this.buf.toString('utf8', this.pos, this.pos + len);
        this.pos += len;
        return s;
    }
    rTag(type) {
        switch (type) {
            case 1: return { t: 1, v: this.rI8() };
            case 2: return { t: 2, v: this.rI16() };
            case 3: return { t: 3, v: this.rI32() };
            case 4: return { t: 4, v: this.rI64() };
            case 5: return { t: 5, v: this.rF32() };
            case 6: return { t: 6, v: this.rF64() };
            case 7: {
                const n = this.rI32();
                const v = this.buf.slice(this.pos, this.pos + n);
                this.pos += n;
                return { t: 7, v };
            }
            case 8: return { t: 8, v: this.rStr() };
            case 9: return this.rList();
            case 10: return this.rCompound();
            case 11: {
                const n = this.rI32();
                const v = [];
                for (let i = 0; i < n; i++)
                    v.push(this.rI32());
                return { t: 11, v };
            }
            case 12: {
                const n = this.rI32();
                const v = [];
                for (let i = 0; i < n; i++)
                    v.push(this.rI64());
                return { t: 12, v };
            }
            default: throw new Error(`Unknown NBT type ${type} at ${this.pos}`);
        }
    }
    rList() {
        const et = this.rU8();
        const n = this.rI32();
        const v = [];
        for (let i = 0; i < n; i++)
            v.push(et === 0 ? { t: 10, v: new Map() } : this.rTag(et));
        return { t: 9, v, et: et || 10 };
    }
    rCompound() {
        const map = new Map();
        for (;;) {
            const type = this.rU8();
            if (type === 0)
                break;
            const name = this.rStr();
            map.set(name, this.rTag(type));
        }
        return { t: 10, v: map };
    }
    readRoot() {
        const type = this.rU8();
        if (type !== 10)
            throw new Error('NBT root must be TAG_Compound');
        this.rStr();
        return this.rCompound();
    }
}
// ── Typed writer ─────────────────────────────────────────────────────────────
class TypedWriter {
    constructor() {
        this.parts = [];
    }
    wU8(v) { const b = Buffer.alloc(1); b.writeUInt8(v); this.parts.push(b); }
    wI8(v) { const b = Buffer.alloc(1); b.writeInt8(v); this.parts.push(b); }
    wI16(v) { const b = Buffer.alloc(2); b.writeInt16BE(v); this.parts.push(b); }
    wI32(v) { const b = Buffer.alloc(4); b.writeInt32BE(v); this.parts.push(b); }
    wI64(v) { const b = Buffer.alloc(8); b.writeBigInt64BE(v); this.parts.push(b); }
    wF32(v) { const b = Buffer.alloc(4); b.writeFloatBE(v); this.parts.push(b); }
    wF64(v) { const b = Buffer.alloc(8); b.writeDoubleBE(v); this.parts.push(b); }
    wStr(s) {
        const enc = Buffer.from(s, 'utf8');
        this.wI16(enc.length);
        this.parts.push(enc);
    }
    wTag(tag) {
        switch (tag.t) {
            case 1:
                this.wI8(tag.v);
                break;
            case 2:
                this.wI16(tag.v);
                break;
            case 3:
                this.wI32(tag.v);
                break;
            case 4:
                this.wI64(tag.v);
                break;
            case 5:
                this.wF32(tag.v);
                break;
            case 6:
                this.wF64(tag.v);
                break;
            case 7:
                this.wI32(tag.v.length);
                this.parts.push(tag.v);
                break;
            case 8:
                this.wStr(tag.v);
                break;
            case 9: {
                const et = tag.v.length > 0 ? tag.v[0].t : tag.et;
                this.wU8(tag.v.length > 0 ? et : 0);
                this.wI32(tag.v.length);
                for (const item of tag.v)
                    this.wTag(item);
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
            case 11:
                this.wI32(tag.v.length);
                for (const v of tag.v)
                    this.wI32(v);
                break;
            case 12:
                this.wI32(tag.v.length);
                for (const v of tag.v)
                    this.wI64(v);
                break;
        }
    }
    writeRoot(compound, name = '') {
        this.wU8(10);
        this.wStr(name);
        this.wTag(compound);
    }
    toBuffer() { return Buffer.concat(this.parts); }
}
// ── Helpers ───────────────────────────────────────────────────────────────────
function parseItemList(list) {
    if (!list || list.t !== 9)
        return [];
    return list.v
        .filter((item) => item.t === 10)
        .map(item => {
        const slotTag = item.v.get('Slot');
        const idTag = item.v.get('id');
        const countTag = item.v.get('Count');
        return {
            slot: slotTag && (slotTag.t === 1 || slotTag.t === 3) ? Math.abs(slotTag.v) : 0,
            id: idTag && idTag.t === 8 ? idTag.v.replace('minecraft:', '') : '',
            count: countTag && (countTag.t === 1 || countTag.t === 3) ? Math.abs(countTag.v) : 1,
        };
    })
        .filter(item => item.id);
}
function readPlayerDat(filePath) {
    if (!fs_1.default.existsSync(filePath))
        return { inventory: [], enderChest: [] };
    try {
        const root = new TypedReader((0, zlib_1.gunzipSync)(fs_1.default.readFileSync(filePath))).readRoot();
        return {
            inventory: parseItemList(root.v.get('Inventory')),
            enderChest: parseItemList(root.v.get('EnderItems')),
        };
    }
    catch {
        return { inventory: [], enderChest: [] };
    }
}
function readPlayerLocation(filePath) {
    if (!fs_1.default.existsSync(filePath))
        return null;
    try {
        const root = new TypedReader((0, zlib_1.gunzipSync)(fs_1.default.readFileSync(filePath))).readRoot();
        const posTag = root.v.get('Pos');
        let x = 0, y = 0, z = 0;
        if (posTag && posTag.t === 9 && posTag.v.length >= 3) {
            x = Number(posTag.v[0].v);
            y = Number(posTag.v[1].v);
            z = Number(posTag.v[2].v);
        }
        const dimTag = root.v.get('Dimension');
        const dimension = dimTag && dimTag.t === 8 ? dimTag.v.replace('minecraft:', '') : 'overworld';
        const hpTag = root.v.get('Health');
        const health = hpTag && (hpTag.t === 5 || hpTag.t === 6) ? Math.round(hpTag.v) : 0;
        const xpTag = root.v.get('XpLevel');
        const xpLevel = xpTag && xpTag.t === 3 ? xpTag.v : 0;
        return { x: Math.round(x), y: Math.round(y), z: Math.round(z), dimension, health, xpLevel };
    }
    catch {
        return null;
    }
}
function readPlayerStats(statsFilePath) {
    const empty = { playTimeTicks: 0, deaths: 0, walkOneCm: 0, sprintOneCm: 0, jumps: 0, playerKills: 0, mobKills: 0, blocksMinedTotal: 0 };
    if (!fs_1.default.existsSync(statsFilePath))
        return empty;
    try {
        const data = JSON.parse(fs_1.default.readFileSync(statsFilePath, 'utf8'));
        const custom = data?.stats?.['minecraft:custom'] ?? {};
        const mined = data?.stats?.['minecraft:mined'] ?? {};
        return {
            playTimeTicks: custom['minecraft:play_time'] ?? custom['minecraft:total_world_time'] ?? 0,
            deaths: custom['minecraft:deaths'] ?? 0,
            walkOneCm: custom['minecraft:walk_one_cm'] ?? 0,
            sprintOneCm: custom['minecraft:sprint_one_cm'] ?? 0,
            jumps: custom['minecraft:jump'] ?? 0,
            playerKills: custom['minecraft:player_kills'] ?? 0,
            mobKills: custom['minecraft:mob_kills'] ?? 0,
            blocksMinedTotal: Object.values(mined).reduce((a, v) => a + v, 0),
        };
    }
    catch {
        return empty;
    }
}
function removeInventoryItem(filePath, slot, fromEnderChest = false) {
    if (!fs_1.default.existsSync(filePath))
        return false;
    try {
        const root = new TypedReader((0, zlib_1.gunzipSync)(fs_1.default.readFileSync(filePath))).readRoot();
        const key = fromEnderChest ? 'EnderItems' : 'Inventory';
        const list = root.v.get(key);
        if (!list || list.t !== 9)
            return false;
        const l = list;
        const before = l.v.length;
        l.v = l.v.filter(item => {
            if (item.t !== 10)
                return true;
            const s = item.v.get('Slot');
            return !s || Math.abs(Number(s.v)) !== slot;
        });
        if (l.v.length === before)
            return false;
        const writer = new TypedWriter();
        writer.writeRoot(root);
        fs_1.default.writeFileSync(filePath, (0, zlib_1.gzipSync)(writer.toBuffer()));
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=nbtReader.js.map