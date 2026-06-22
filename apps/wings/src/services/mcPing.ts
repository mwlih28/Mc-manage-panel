import net from 'net';

function encodeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return Buffer.from(bytes);
}

function decodeVarInt(buf: Buffer, offset: number): { value: number; size: number } {
  let value = 0;
  let size = 0;
  let byte: number;
  do {
    if (offset + size >= buf.length) throw new Error('Buffer too short');
    byte = buf[offset + size];
    value |= (byte & 0x7f) << (7 * size);
    size++;
    if (size > 5) throw new Error('VarInt too large');
  } while (byte & 0x80);
  return { value, size };
}

function encodeString(str: string): Buffer {
  const encoded = Buffer.from(str, 'utf8');
  return Buffer.concat([encodeVarInt(encoded.length), encoded]);
}

function buildHandshake(host: string, port: number): Buffer {
  const packetId = encodeVarInt(0x00);
  const protocolVersion = encodeVarInt(764); // 1.20.4
  const serverAddress = encodeString(host);
  const serverPort = Buffer.alloc(2);
  serverPort.writeUInt16BE(port, 0);
  const nextState = encodeVarInt(1);

  const payload = Buffer.concat([packetId, protocolVersion, serverAddress, serverPort, nextState]);
  return Buffer.concat([encodeVarInt(payload.length), payload]);
}

function buildStatusRequest(): Buffer {
  const payload = encodeVarInt(0x00);
  return Buffer.concat([encodeVarInt(payload.length), payload]);
}

export interface PingResult {
  online: number;
  max: number;
  players: { name: string; id: string }[];
}

export async function pingServer(host: string, port: number, timeoutMs = 5000): Promise<PingResult> {
  return new Promise((resolve) => {
    const fallback: PingResult = { online: 0, max: 0, players: [] };
    let settled = false;

    const done = (result: PingResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => done(fallback), timeoutMs);

    const socket = net.createConnection({ host, port }, () => {
      socket.write(buildHandshake(host, port));
      socket.write(buildStatusRequest());
    });

    socket.on('error', () => done(fallback));

    let buf = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        // Read packet length
        const lenField = decodeVarInt(buf, 0);
        const totalLen = lenField.size + lenField.value;
        if (buf.length < totalLen) return; // wait for more data

        // Read packet ID
        const idField = decodeVarInt(buf, lenField.size);
        if (idField.value !== 0x00) return done(fallback);

        // Read JSON string
        let strOffset = lenField.size + idField.size;
        const strLen = decodeVarInt(buf, strOffset);
        strOffset += strLen.size;
        const json = buf.slice(strOffset, strOffset + strLen.value).toString('utf8');

        const parsed = JSON.parse(json);
        const result: PingResult = {
          online: parsed?.players?.online ?? 0,
          max: parsed?.players?.max ?? 0,
          players: (parsed?.players?.sample ?? []).map((p: { name: string; id: string }) => ({
            name: p.name,
            id: p.id,
          })),
        };
        done(result);
      } catch {
        // incomplete data — wait for more
      }
    });
  });
}
