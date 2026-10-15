// shortcut: mock data, replace with API when an error-tracking endpoint exists.
// Issues are plant-stack failures (edge bridge, ingest, vision, API, console)
// so the page reads as part of this product, not a copy of someone else's.

export type IssueStatus = 'review' | 'reviewed' | 'ignored';

export interface Issue {
  id: string;
  type: string;
  message: string;
  service: string;
  env: 'prod' | 'staging';
  status: IssueStatus;
  count: number;
  firstSeenH: number;   // hours ago
  lastSeenM: number;    // minutes ago
  file: string;
  line: number;
  stack: string[];
  code: { n: number; text: string }[];
}

export const ISSUES: Issue[] = [
  {
    id: 'ERR-1042', type: 'TimeoutError', message: 'Modbus read of holding register 40012 timed out after 2000 ms',
    service: 'edge-bridge', env: 'prod', status: 'review', count: 496, firstSeenH: 720, lastSeenM: 5,
    file: 'edge/adapters/modbus.py', line: 88,
    stack: ['edge/adapters/modbus.py:88 in read_registers', 'edge/poller.py:141 in poll_once', 'edge/poller.py:97 in run'],
    code: [
      { n: 85, text: 'async def read_registers(self, addr, count):' },
      { n: 86, text: '    req = ReadHoldingRegisters(addr, count)' },
      { n: 87, text: '    async with timeout(self.cfg.read_timeout_s):' },
      { n: 88, text: '        return await self.client.execute(req)' },
      { n: 89, text: '' },
    ],
  },
  {
    id: 'ERR-1038', type: 'ConnectionRefusedError', message: 'MQTT broker refused connection on :8883 (not authorised)',
    service: 'mqtt-ingest', env: 'prod', status: 'review', count: 212, firstSeenH: 30, lastSeenM: 12,
    file: 'backend/app/ingest.py', line: 54,
    stack: ['backend/app/ingest.py:54 in connect', 'backend/app/main.py:211 in lifespan'],
    code: [
      { n: 52, text: 'async def connect(self):' },
      { n: 53, text: '    tls = ssl.create_default_context(cafile=self.ca)' },
      { n: 54, text: '    await self.client.connect(self.host, 8883, tls=tls)' },
    ],
  },
  {
    id: 'ERR-1031', type: 'RuntimeError', message: 'CUDA out of memory while running YOLO segmentation batch (size 8)',
    service: 'vision-yolo', env: 'prod', status: 'reviewed', count: 37, firstSeenH: 96, lastSeenM: 48,
    file: 'vision/infer.py', line: 120,
    stack: ['vision/infer.py:120 in segment_batch', 'vision/worker.py:66 in handle_frame'],
    code: [
      { n: 118, text: 'def segment_batch(self, frames):' },
      { n: 119, text: '    x = torch.stack(frames).to(self.device)' },
      { n: 120, text: '    return self.model(x, imgsz=self.size)' },
    ],
  },
  {
    id: 'ERR-1027', type: 'KeyError', message: "'belt_speed' missing from telemetry frame",
    service: 'mqtt-ingest', env: 'staging', status: 'review', count: 88, firstSeenH: 6, lastSeenM: 3,
    file: 'backend/app/ingest.py', line: 132,
    stack: ['backend/app/ingest.py:132 in normalise', 'backend/app/ingest.py:101 in on_message'],
    code: [
      { n: 130, text: 'def normalise(frame):' },
      { n: 131, text: '    ts = frame["ts"]' },
      { n: 132, text: '    speed = frame["belt_speed"]' },
    ],
  },
  {
    id: 'ERR-1019', type: 'TypeError', message: "Cannot read properties of undefined (reading 'v')",
    service: 'web-console', env: 'prod', status: 'review', count: 64, firstSeenH: 50, lastSeenM: 21,
    file: 'web/src/features/line/Mimic.tsx', line: 42,
    stack: ['web/src/features/line/Mimic.tsx:42 in Mimic', 'react-dom: renderWithHooks'],
    code: [
      { n: 40, text: 'const tv = live.latest[tag];' },
      { n: 41, text: '// tag can be unseen before first WS frame' },
      { n: 42, text: 'const value = tv.v;' },
    ],
  },
  {
    id: 'ERR-1012', type: 'ValueError', message: 'Setpoint 4.2 m/s outside allowed range 0.0–3.0',
    service: 'api', env: 'prod', status: 'ignored', count: 9, firstSeenH: 200, lastSeenM: 600,
    file: 'backend/app/commands.py', line: 77,
    stack: ['backend/app/commands.py:77 in validate', 'backend/app/main.py:388 in post_command'],
    code: [
      { n: 75, text: 'def validate(tag, value):' },
      { n: 76, text: '    lo, hi = LIMITS[tag]' },
      { n: 77, text: '    if not lo <= value <= hi: raise ValueError(...)' },
    ],
  },
  {
    id: 'ERR-1008', type: 'JSONDecodeError', message: 'Expecting value: line 1 column 1 (char 0)',
    service: 'api', env: 'staging', status: 'review', count: 15, firstSeenH: 12, lastSeenM: 90,
    file: 'backend/app/edges.py', line: 40,
    stack: ['backend/app/edges.py:40 in parse_hello', 'backend/app/edges.py:22 in register'],
    code: [
      { n: 39, text: 'def parse_hello(raw: bytes):' },
      { n: 40, text: '    return json.loads(raw)' },
    ],
  },
];

/** Deterministic 24-bucket hourly histogram per issue (no Math.random — stable renders). */
export function histogram(issue: Issue): number[] {
  let seed = 0;
  for (const c of issue.id) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < 24; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    out.push(Math.round(((seed >>> 8) % 1000) / 1000 * (issue.count / 12)));
  }
  return out;
}
