import { expect, test } from 'bun:test';
import { decodeFrames, encodeFrame } from './ws';

/** What a browser sends: a masked text frame. */
function clientFrame(text: string, mask = [0x12, 0x34, 0x56, 0x78]): Buffer {
  const body = Buffer.from(text);
  const head = body.length < 126 ? [0x81, 0x80 | body.length] : [0x81, 0x80 | 126, body.length >> 8, body.length & 0xff];
  const masked = Buffer.from(body.map((b, i) => b ^ mask[i & 3]));
  return Buffer.concat([Buffer.from(head), Buffer.from(mask), masked]);
}

test('decodes masked client frames, short and 16-bit length', () => {
  const long = 'x'.repeat(300);
  const { frames, rest } = decodeFrames(Buffer.concat([clientFrame('{"type":"auth"}'), clientFrame(long)]));
  expect(frames.map((f) => f.payload.toString())).toEqual(['{"type":"auth"}', long]);
  expect(rest.length).toBe(0);
});

test('a frame split across chunks waits for the rest', () => {
  const whole = clientFrame('{"type":"ping"}');
  const first = decodeFrames(whole.subarray(0, 5));
  expect(first.frames).toHaveLength(0);
  const second = decodeFrames(Buffer.concat([first.rest, whole.subarray(5)]));
  expect(second.frames[0].payload.toString()).toBe('{"type":"ping"}');
});

test('server frames round-trip through the decoder (unmasked)', () => {
  const big = JSON.stringify({ type: 'tag', v: 'y'.repeat(70000) });
  const { frames } = decodeFrames(Buffer.concat([encodeFrame('hi'), encodeFrame(big)]));
  expect(frames.map((f) => [f.opcode, f.payload.toString().length])).toEqual([[1, 2], [1, big.length]]);
});
