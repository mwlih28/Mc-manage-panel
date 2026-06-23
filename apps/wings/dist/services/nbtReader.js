"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPlayerDat = readPlayerDat;
const zlib_1 = require("zlib");
const fs_1 = __importDefault(require("fs"));
class NbtReader {
    constructor(buf) {
        this.pos = 0;
        this.buf = buf;
    }
    readUByte() { return this.buf.readUInt8(this.pos++); }
    readByte() { return this.buf.readInt8(this.pos++); }
    readShort() { const v = this.buf.readInt16BE(this.pos); this.pos += 2; return v; }
    readInt() { const v = this.buf.readInt32BE(this.pos); this.pos += 4; return v; }
    readLong() { const v = this.buf.readBigInt64BE(this.pos); this.pos += 8; return Number(v); }
    readFloat() { const v = this.buf.readFloatBE(this.pos); this.pos += 4; return v; }
    readDouble() { const v = this.buf.readDoubleBE(this.pos); this.pos += 8; return v; }
    readString() { const len = this.buf.readUInt16BE(this.pos); this.pos += 2; const s = this.buf.toString('utf8', this.pos, this.pos + len); this.pos += len; return s; }
    readPayload(type) {
        switch (type) {
            case 1: return this.readByte();
            case 2: return this.readShort();
            case 3: return this.readInt();
            case 4: return this.readLong();
            case 5: return this.readFloat();
            case 6: return this.readDouble();
            case 7: {
                const len = this.readInt();
                const arr = this.buf.slice(this.pos, this.pos + len);
                this.pos += len;
                return arr;
            }
            case 8: return this.readString();
            case 9: return this.readList();
            case 10: return this.readCompound();
            case 11: {
                const len = this.readInt();
                const arr = [];
                for (let i = 0; i < len; i++)
                    arr.push(this.readInt());
                return arr;
            }
            case 12: {
                const len = this.readInt();
                const arr = [];
                for (let i = 0; i < len; i++)
                    arr.push(this.readLong());
                return arr;
            }
            default: throw new Error(`Unknown NBT type ${type} at pos ${this.pos}`);
        }
    }
    readList() {
        const elemType = this.readUByte();
        const len = this.readInt();
        const arr = [];
        for (let i = 0; i < len; i++)
            arr.push(elemType === 0 ? null : this.readPayload(elemType));
        return arr;
    }
    readCompound() {
        const obj = {};
        for (;;) {
            const type = this.readUByte();
            if (type === 0)
                break;
            const name = this.readString();
            obj[name] = this.readPayload(type);
        }
        return obj;
    }
    readRoot() {
        const type = this.readUByte();
        if (type !== 10)
            throw new Error('NBT root must be compound');
        this.readString(); // root name (usually empty)
        return this.readCompound();
    }
}
function readPlayerDat(filePath) {
    if (!fs_1.default.existsSync(filePath))
        return { inventory: [], enderChest: [] };
    const compressed = fs_1.default.readFileSync(filePath);
    const buf = (0, zlib_1.gunzipSync)(compressed);
    const root = new NbtReader(buf).readRoot();
    const parseItems = (list) => {
        if (!Array.isArray(list))
            return [];
        return list
            .filter(Boolean)
            .map(item => ({
            slot: item.Slot ?? 0,
            id: (item.id ?? '').replace('minecraft:', ''),
            count: item.Count ?? 1,
        }))
            .filter(item => item.id);
    };
    return {
        inventory: parseItems(root.Inventory),
        enderChest: parseItems(root.EnderItems),
    };
}
//# sourceMappingURL=nbtReader.js.map