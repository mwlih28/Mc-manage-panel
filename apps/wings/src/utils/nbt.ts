// Minimal NBT (Named Binary Tag) reader — the format Minecraft uses for
// chunk data inside .mca region files. Only reading is implemented since
// the world-map feature only ever needs to inspect saved chunks, never
// write them back.
export type NbtValue =
  | number
  | bigint
  | string
  | Uint8Array
  | Int32Array
  | BigInt64Array
  | NbtValue[]
  | { [key: string]: NbtValue };

const TAG_END = 0;
const TAG_BYTE = 1;
const TAG_SHORT = 2;
const TAG_INT = 3;
const TAG_LONG = 4;
const TAG_FLOAT = 5;
const TAG_DOUBLE = 6;
const TAG_BYTE_ARRAY = 7;
const TAG_STRING = 8;
const TAG_LIST = 9;
const TAG_COMPOUND = 10;
const TAG_INT_ARRAY = 11;
const TAG_LONG_ARRAY = 12;

class NbtReader {
  private offset = 0;
  constructor(private buf: Buffer) {}

  private readByte(): number {
    const v = this.buf.readInt8(this.offset);
    this.offset += 1;
    return v;
  }
  private readUByte(): number {
    const v = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }
  private readShort(): number {
    const v = this.buf.readInt16BE(this.offset);
    this.offset += 2;
    return v;
  }
  private readInt(): number {
    const v = this.buf.readInt32BE(this.offset);
    this.offset += 4;
    return v;
  }
  private readLong(): bigint {
    const v = this.buf.readBigInt64BE(this.offset);
    this.offset += 8;
    return v;
  }
  private readFloat(): number {
    const v = this.buf.readFloatBE(this.offset);
    this.offset += 4;
    return v;
  }
  private readDouble(): number {
    const v = this.buf.readDoubleBE(this.offset);
    this.offset += 8;
    return v;
  }
  private readString(): string {
    const len = this.buf.readUInt16BE(this.offset);
    this.offset += 2;
    const str = this.buf.toString('utf8', this.offset, this.offset + len);
    this.offset += len;
    return str;
  }

  private readPayload(tagType: number): NbtValue {
    switch (tagType) {
      case TAG_BYTE:
        return this.readByte();
      case TAG_SHORT:
        return this.readShort();
      case TAG_INT:
        return this.readInt();
      case TAG_LONG:
        return this.readLong();
      case TAG_FLOAT:
        return this.readFloat();
      case TAG_DOUBLE:
        return this.readDouble();
      case TAG_BYTE_ARRAY: {
        const len = this.readInt();
        const arr = new Uint8Array(this.buf.subarray(this.offset, this.offset + len));
        this.offset += len;
        return arr;
      }
      case TAG_STRING:
        return this.readString();
      case TAG_LIST: {
        const childType = this.readUByte();
        const len = this.readInt();
        const list: NbtValue[] = [];
        for (let i = 0; i < len; i++) {
          list.push(this.readPayload(childType));
        }
        return list;
      }
      case TAG_COMPOUND: {
        const obj: { [key: string]: NbtValue } = {};
        for (;;) {
          const childType = this.readUByte();
          if (childType === TAG_END) break;
          const name = this.readString();
          obj[name] = this.readPayload(childType);
        }
        return obj;
      }
      case TAG_INT_ARRAY: {
        const len = this.readInt();
        const arr = new Int32Array(len);
        for (let i = 0; i < len; i++) arr[i] = this.readInt();
        return arr;
      }
      case TAG_LONG_ARRAY: {
        const len = this.readInt();
        const arr = new BigInt64Array(len);
        for (let i = 0; i < len; i++) arr[i] = this.readLong();
        return arr;
      }
      default:
        throw new Error(`Unknown NBT tag type ${tagType} at offset ${this.offset}`);
    }
  }

  readRoot(): { name: string; value: NbtValue } {
    const tagType = this.readUByte();
    if (tagType === TAG_END) return { name: '', value: {} };
    const name = this.readString();
    const value = this.readPayload(tagType);
    return { name, value };
  }
}

export function parseNbt(buf: Buffer): { name: string; value: NbtValue } {
  return new NbtReader(buf).readRoot();
}
