// CurseForge fingerprints a file with MurmurHash2 (32-bit, seed 1) computed
// over the file's bytes with whitespace characters (tab/LF/CR/space)
// stripped out first — an undocumented but well-known quirk of their API
// that every third-party CurseForge client has to replicate byte-for-byte
// to get matching fingerprints.
const WHITESPACE_BYTES = new Set([0x09, 0x0a, 0x0d, 0x20]);

function murmur2(data: Buffer, seed: number): number {
  const m = 0x5bd1e995;
  const r = 24;
  let len = data.length;
  let h = (seed ^ len) >>> 0;
  let i = 0;

  while (len >= 4) {
    let k = (data[i] & 0xff) | ((data[i + 1] & 0xff) << 8) | ((data[i + 2] & 0xff) << 16) | ((data[i + 3] & 0xff) << 24);
    k = Math.imul(k, m) >>> 0;
    k ^= k >>> r;
    k = Math.imul(k, m) >>> 0;
    h = Math.imul(h, m) >>> 0;
    h ^= k;
    i += 4;
    len -= 4;
  }

  switch (len) {
    case 3: h ^= (data[i + 2] & 0xff) << 16; // falls through
    case 2: h ^= (data[i + 1] & 0xff) << 8; // falls through
    case 1:
      h ^= data[i] & 0xff;
      h = Math.imul(h, m) >>> 0;
  }

  h ^= h >>> 13;
  h = Math.imul(h, m) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

export function curseForgeFingerprint(buffer: Buffer): number {
  const filtered = Buffer.from([...buffer].filter((b) => !WHITESPACE_BYTES.has(b)));
  return murmur2(filtered, 1);
}
