// Minimal RFC 6455 WebSocket server for the dev mock's /ws — text frames,
// ping/pong and close only, which is all the console's client (src/lib/ws.ts)
// speaks. Hooks the Vite dev server's `upgrade` event for /ws alone, so
// Vite's own HMR socket is untouched. No dependency: the codec is ~40 lines.

import { createHash } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Server → client frame: FIN + opcode, unmasked (servers never mask). */
export function encodeFrame(payload: string | Buffer, opcode = 0x1): Buffer {
  const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const n = body.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n])
    : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 0xff])
    : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, body]);
}

export interface Frame { opcode: number; payload: Buffer }

/** Parse every complete frame at the front of `buf`; returns them and the
 *  unconsumed tail (a frame split across TCP chunks waits for the rest).
 *  Client frames are masked (RFC 6455 §5.3); fragmentation is not used by
 *  browsers for the small JSON frames this client sends. */
export function decodeFrames(buf: Buffer): { frames: Frame[]; rest: Buffer } {
  const frames: Frame[] = [];
  let off = 0;
  while (buf.length - off >= 2) {
    const b1 = buf[off + 1];
    let len = b1 & 0x7f;
    let p = off + 2;
    if (len === 126) { if (buf.length < p + 2) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (buf.length < p + 8) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    const masked = (b1 & 0x80) !== 0;
    const mask = masked ? buf.subarray(p, p + 4) : null;
    if (masked) p += 4;
    if (buf.length < p + len) break;
    const payload = Buffer.from(buf.subarray(p, p + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    frames.push({ opcode: buf[off] & 0x0f, payload });
    off = p + len;
  }
  return { frames, rest: buf.subarray(off) };
}

export interface Conn {
  send(obj: unknown): void;
  close(code?: number): void;
  onText(fn: (text: string) => void): void;
  onClose(fn: () => void): void;
}

export function attachWs(server: Server, path: string, onConn: (c: Conn, req: IncomingMessage) => void): void {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== path) return;   // not ours (HMR, proxies)
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string') { socket.destroy(); return; }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let open = true;
    let pending: Buffer = Buffer.alloc(0);
    const texts: ((t: string) => void)[] = [];
    const closes: (() => void)[] = [];
    const close = (code = 1000) => {
      if (!open) return;
      open = false;
      const b = Buffer.alloc(2); b.writeUInt16BE(code);
      socket.end(encodeFrame(b, 0x8));
      for (const fn of closes) fn();
    };
    socket.on('data', (chunk: Buffer) => {
      const { frames, rest } = decodeFrames(Buffer.concat([pending, chunk]));
      pending = rest;
      for (const f of frames) {
        if (f.opcode === 0x1) for (const fn of texts) fn(f.payload.toString('utf8'));
        else if (f.opcode === 0x9) socket.write(encodeFrame(f.payload, 0xa));
        else if (f.opcode === 0x8) close();
      }
    });
    const gone = () => { if (open) { open = false; for (const fn of closes) fn(); } };
    socket.on('close', gone);
    socket.on('error', gone);
    onConn({
      send: (obj) => { if (open) socket.write(encodeFrame(JSON.stringify(obj))); },
      close,
      onText: (fn) => { texts.push(fn); },
      onClose: (fn) => { closes.push(fn); },
    }, req);
  });
}
