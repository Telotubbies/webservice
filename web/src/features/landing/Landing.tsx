// Landing — the vissointan public page. Same chrome as before (ticker,
// bordered nav, cartesian hero, corner-tick buttons, dual theme by the Thai
// clock) carrying our own product: a three.js twin of the sorting line in the
// hero, the protocols we actually speak, real console screenshots, a
// four-step "connect your plant" guide, and an honest FAQ. EN/TH copy lives
// here (public page, no i18n namespace); the language toggle shares the
// app-wide setting so the console opens in the same language.

import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { signIn } from '../../app/session';
import { api, setSessionToken } from '../../lib/api';
import { setLang } from '../../lib/i18n';
import { authConfig } from '../auth/oidc';
import { HeroVector } from './HeroVector';
import './landing.css';
import './vz.css';

const HeroLine3D = lazy(() => import('./HeroLine3D'));

/** A failed chunk load or WebGL crash must not take the page down — render
 *  nothing and let the vector drawing underneath stay visible. */
class TwinBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

/* ---------- bundled path icons (15×15) ------------------------------------ */
const I = {
  chevron: 'M4.50001 5.79289L7.50001 8.79289L10.5 5.79289L11.2071 6.5L7.50001 10.2071L3.79291 6.5L4.50001 5.79289Z',
  arrowR:
    'M6.14645 5.14645L5.79289 5.5L6.5 6.20711L6.85355 5.85355L6.14645 5.14645ZM8.5 3.5L8.85355 3.85355L9.20711 3.5L8.85355 3.14645L8.5 3.5ZM6.85355 1.14645L6.5 0.792893L5.79289 1.5L6.14645 1.85355L6.85355 1.14645ZM6.85355 5.85355L8.85355 3.85355L8.14645 3.14645L6.14645 5.14645L6.85355 5.85355ZM8.85355 3.14645L6.85355 1.14645L6.14645 1.85355L8.14645 3.85355L8.85355 3.14645ZM8.5 3H0V4H8.5V3Z',
  arrowTR:
    'M11.4986 3.49866L11.9992 3.49866L11.9985 2.99873L11.4986 2.99803L11.4986 3.49866ZM10.9979 3.49866L10.9972 9L11.9985 9L11.9992 3.49866L10.9979 3.49866ZM11.4986 2.99803L5.99941 2.99888V4.00014L11.4986 3.99929L11.4986 2.99803ZM11.145 3.14511L2.30618 11.9839L3.01328 12.691L11.8521 3.85221L11.145 3.14511Z',
  // line-art glyphs for rows, chips and steps
  gauge: 'M7.5 2a6 6 0 0 0-6 6v1h1V8a5 5 0 0 1 10 0v1h1V8a6 6 0 0 0-6-6Zm2.65 3.15-2.5 2.5a1 1 0 1 0 .7.7l2.5-2.5-.7-.7Z',
  bell: 'M7.5 1a4 4 0 0 0-4 4v3L2 10.5V11h11v-.5L11.5 8V5a4 4 0 0 0-4-4Zm-3 4a3 3 0 0 1 6 0v3.3l1 1.7h-8l1-1.7V5Zm1.5 7.5a1.5 1.5 0 0 0 3 0H6Z',
  eye: 'M7.5 3C4 3 1.6 5.6 1 7.5 1.6 9.4 4 12 7.5 12s5.9-2.6 6.5-4.5C13.4 5.6 11 3 7.5 3Zm0 8C4.9 11 3 9.2 2.1 7.5 3 5.8 4.9 4 7.5 4s4.5 1.8 5.4 3.5C12 9.2 10.1 11 7.5 11Zm0-6a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm0 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z',
  chart: 'M2 2h1v10h10v1H2V2Zm3 7 2.5-3 2 2L12 4.5l.8.6-3.2 4.3-2-2L5.8 9.6 5 9Z',
  bolt: 'M8.5 1 3 8.5h4L6 14l6-8H8l.5-5Zm-1 3.4L7.2 7H10L7.8 9.9l.4-2.4H5L7.5 4.4Z',
  plug: 'M5 1h1v3h3V1h1v3h1v3a3.5 3.5 0 0 1-3 3.46V14H7v-3.54A3.5 3.5 0 0 1 4 7V4h1V1Zm0 4v2a2.5 2.5 0 0 0 5 0V5H5Z',
  cube: 'M7.5 1 13 4v7l-5.5 3L2 11V4l5.5-3Zm0 1.15L3.4 4.4l4.1 2.25 4.1-2.25L7.5 2.15ZM3 5.25v5.15l4 2.2V7.45l-4-2.2Zm5 7.35 4-2.2V5.25l-4 2.2v5.15Z',
  shield: 'M7.5 1 13 3v4c0 3.4-2.3 5.9-5.5 7C4.3 12.9 2 10.4 2 7V3l5.5-2ZM3 3.7V7c0 2.8 1.8 4.9 4.5 5.9C10.2 11.9 12 9.8 12 7V3.7L7.5 2.06 3 3.7Z',
};

function HxIcon({ d, size = 15, className = '' }: { d: string; size?: number; className?: string }) {
  return (
    <svg className={className} height={size} viewBox="0 0 15 15" width={size} aria-hidden>
      <path clipRule="evenodd" d={d} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/* pixel-star sparkle beside the hero h1 */
function Sparkle() {
  return (
    <svg className="hx-sparkle" width="51" height="52" viewBox="0 0 51 52" fill="none" aria-hidden>
      <path fill="currentColor" d="M51 52h-4v-4h4zm-4-4h-4v-4h4zm-4-4h-4v-4h4zm-4-4h-4v-4h4zm12-16v4H35v-4zm-35-8h-4v-4h4zm12 0h-4V0h4zm11 0h-4v-4h4zm-27-4H8V8h4zm31 0h-4V8h4zM8 8H4V4h4zm39 0h-4V4h4zM4 4H0V0h4zm47 0h-4V0h4z" />
    </svg>
  );
}

/* ---------- copy (EN / TH) ------------------------------------------------- */
type Row = { id: string; icon: keyof typeof I; title: string; body: string; points: string[]; img: string; alt: string; flip?: boolean };
type Copy = {
  ticker: { b: string; t: string }[];
  nav: { id: string; label: string; items: { t: string; d: string; href: string }[] }[];
  login: string; start: string;
  h1a: string; h1b: string;
  subPre: string; chips: [string, string, string]; subPost: string;
  ctaPrimary: string; ctaSecondary: string;
  twin: { title: string; motor: string; vision: string; gravel: string; sand: string; counted: string; hint: string };
  protoLabel: string;
  approachH: string; approachP: string;
  rows: Row[];
  ethos: { tag: string; cls: string; h: string; p: string; list: string[] }[];
  connectH: string; connectEm: string; connectP: string;
  steps: { n: string; t: string; d: string; where: string }[];
  ucH: string; ucEm: string;
  uc: { t: string; d: string; ic: keyof typeof I }[];
  stackH: string; stackEm: string; stackP: string;
  startH: string; startP: string; startBtn: string; startGhost: string;
  tokenPh: string; tokenPhDev: string; tokenEnter: string; tokenBusy: string; tokenErr: string;
  startR: string; startRBtn: string;
  faqH: string; faq: { q: string; a: string }[]; faqMore: string; faqMoreLink: string;
  foot: { h: string; links: { t: string; href: string }[] }[];
  made: string; rights: string; tz: string;
};

const ROW_IMG = { overview: '/ours/overview.png', alarms: '/ours/alarms.png', insights: '/ours/insights.png', trends: '/ours/trends.png', commands: '/ours/commands.png' };

const EN: Copy = {
  ticker: [
    { b: 'Aggregate AI:', t: 'per-truck gravel / sand calls from CCTV, written to the PLC only through the gated rule path (dry-run until you switch it on)' },
    { b: 'Factory I/O ready:', t: 'one-click Modbus template for the sorting scene — tags, dashboard and alarm rules' },
    { b: 'Derived tags:', t: 'safe formula language for computed signals, evaluated on the server' },
    { b: 'Zero-trust edge:', t: 'MQTT over TLS with per-device identities and broker ACLs' },
  ],
  nav: [
    {
      id: 'platform', label: 'Platform',
      items: [
        { t: 'Live overview', d: 'KPI tiles, run state and active alarms for the line', href: '#features' },
        { t: 'Alarms & incidents', d: 'Explicit states: triggered, acknowledged, resolved', href: '#features' },
        { t: 'Vision AI', d: 'Camera models that classify material on the belt', href: '#features' },
        { t: 'Supervised commands', d: 'Writes to the PLC with confirm, range check and audit', href: '#features' },
      ],
    },
    {
      id: 'connect', label: 'Connect',
      items: [
        { t: 'Built-in simulator', d: 'A live demo line with no hardware at all', href: '#connect' },
        { t: 'Factory I/O', d: 'Modbus TCP template for the sorting scene', href: '#connect' },
        { t: 'Real PLCs', d: 'Modbus TCP, Siemens S7 and OPC UA via an edge gateway', href: '#connect' },
      ],
    },
    {
      id: 'resources', label: 'Resources',
      items: [
        { t: 'Getting started', d: 'Four steps from sign-in to live data', href: '#connect' },
        { t: 'Use cases', d: 'Where the console fits today', href: '#use-cases' },
        { t: 'FAQ', d: 'Security, protocols and deployment', href: '#faq' },
      ],
    },
  ],
  login: 'Log in', start: 'Get started',
  h1a: 'The operations console',
  h1b: 'for real production lines',
  subPre: 'Watch the line as a', chips: ['live twin', 'vision AI', 'alarms'], subPost: 'and act on it from one browser tab.',
  ctaPrimary: 'Sign in to the console', ctaSecondary: 'How to connect a plant',
  twin: {
    title: 'Sorting line twin: drive motor, belt, vision gantry and two bins',
    motor: 'MOTOR · 58 Hz', vision: 'VISION AI', gravel: 'BIN A · GRAVEL', sand: 'BIN B · SAND',
    counted: 'sorted this visit', hint: 'Move the pointer to orbit',
  },
  protoLabel: 'Speaks the protocols already on your plant floor',
  approachH: 'From PLC tag to decision, in one console',
  approachP: 'Most plants run an HMI for the operator, a historian for the engineer and a spreadsheet for the manager. vissointan puts live values, history, alarms, AI suggestions and supervised commands on the same tags, so everyone looks at the same truth.',
  rows: [
    {
      id: 'overview', icon: 'gauge', title: 'See the whole line at a glance',
      body: 'The overview reads the live store: every tile shows value, unit, sparkline and data quality. Stale or bad values are marked, never hidden.',
      points: ['Run state with last-update age', 'Limits drawn behind the trend', 'Skeletons until real data arrives — no fake "all quiet"'],
      img: ROW_IMG.overview, alt: 'Overview page with belt speed, temperature, bin level and active alarms',
    },
    {
      id: 'alarms', icon: 'bell', flip: true, title: 'Alarms people can trust',
      body: 'Threshold, rate and derived-tag rules raise alarms with explicit states. Criticals stay pinned on top until someone acknowledges them.',
      points: ['Severity coded by colour, icon and label', 'Shelving, downtimes and quality reports', 'Notifications by Web Push to phones'],
      img: ROW_IMG.alarms, alt: 'Alarm list grouped by severity with acknowledge actions',
    },
    {
      id: 'insights', icon: 'eye', title: 'AI proposes, the operator approves',
      body: 'Anomaly and drift detectors raise insights with their evidence. Vision models classify material on the belt; nothing reaches the PLC without the gated write path.',
      points: ['Evidence and score on every insight', 'Per-truck gravel / sand decision', 'Plug in your own model server'],
      img: ROW_IMG.insights, alt: 'Insights page listing anomalies with scores',
    },
    {
      id: 'trends', icon: 'chart', flip: true, title: 'History you can actually query',
      body: 'A PostgreSQL historian with monthly partitions and 1-minute / 1-hour rollups. Trends, notebooks and the query page all read the same tables.',
      points: ['Zoomable trends with alarm bands', 'Export to CSV', 'SLOs and OEE from the same data'],
      img: ROW_IMG.trends, alt: 'Trend chart of belt temperature over time',
    },
    {
      id: 'commands', icon: 'bolt', title: 'Commands with a safety catch',
      body: 'Setpoints and start/stop go through role checks, range limits, rate limits and an explicit confirm, then land in a hash-chained audit trail.',
      points: ['Per-area command rights', 'One write in flight per tag', 'Every write audited with who, what and why'],
      img: ROW_IMG.commands, alt: 'Command page with a confirm dialog for a setpoint change',
    },
  ],
  ethos: [
    {
      tag: 'Open by design', cls: 'gold',
      h: 'Standard protocols, your data, no lock-in',
      p: 'Tags come from the protocols PLCs already speak, history lives in plain PostgreSQL, and every page has an API behind it.',
      list: ['Modbus TCP, Siemens S7 and OPC UA through one edge gateway', 'Self-hosted with Docker Compose', 'REST API with scoped API keys'],
    },
    {
      tag: 'Secure from edge to browser', cls: 'blue',
      h: 'Zero-trust from the gateway up',
      p: 'Each gateway gets its own identity and can only publish into its own topic prefix. People sign in through Keycloak with optional MFA.',
      list: ['MQTT over TLS with per-device broker ACLs', 'Row-level security per organisation in Postgres', 'Roles: owner, admin, operator, viewer'],
    },
  ],
  connectH: 'Connect your plant', connectEm: 'in four steps',
  connectP: 'Start with the simulator, rehearse on Factory I/O, then point the same gateway at a real PLC. The console walks you through it after sign-in.',
  steps: [
    { n: '01', t: 'Sign in and pick a site', d: 'Use your company SSO, Google, or an account an administrator created for you; there is no open sign-up. The demo site already has a simulated line running.', where: '/signin' },
    { n: '02', t: 'Add an edge gateway', d: 'Infrastructure → Add device gives a one-time enrolment code. Start the edge-bridge container next to the PLC with that code.', where: 'Infrastructure → Add device' },
    { n: '03', t: 'Add a data source and tags', d: 'Choose Modbus TCP, Siemens S7 or OPC UA. For Factory I/O, apply the "Factory I/O - Sorting" template: tags, dashboard and alarm rules in one click.', where: 'Infrastructure → Data sources' },
    { n: '04', t: 'Watch, alarm, act', d: 'Values appear on the overview within a second. Add alarm rules, invite your team, and enable commands when you are ready.', where: 'Overview' },
  ],
  ucH: 'Use cases', ucEm: 'Where it fits today',
  uc: [
    { t: 'Aggregate sorting: gravel vs sand', d: 'CCTV over the dump point classifies each truck load; the decision is written to the PLC through the same gated path as any rule.', ic: 'eye' },
    { t: 'Training and commissioning with Factory I/O', d: 'Students and integrators build against a virtual plant over Modbus TCP, then swap in the real PLC without touching dashboards or alarms.', ic: 'cube' },
    { t: 'Remote monitoring for small plants', d: 'One gateway per site, one console for the team, phone notifications for the people on call.', ic: 'plug' },
  ],
  stackH: 'Built on', stackEm: 'open, boring technology',
  stackP: 'Nothing proprietary between your PLC and your browser.',
  startH: 'Ready to see it live?',
  startP: 'Sign in and the demo line is already running. Connect your own equipment when you are ready.',
  startBtn: 'Sign in', startGhost: 'Connection guide',
  tokenPh: 'Access token', tokenPhDev: 'demo-operator · demo-viewer · demo-admin',
  tokenEnter: 'Enter', tokenBusy: 'Signing in…', tokenErr: 'That token didn’t work — check it and try again.',
  startR: 'Developer stack? Paste a dev token to skip the login page.', startRBtn: 'Go to the sign-in page',
  faqH: 'FAQ',
  faq: [
    { q: 'What is vissointan?', a: 'A web operations console for production lines: live values, a 3D and 2D line view, alarms, history, AI insights, vision models and supervised commands, all on one tag model. It started as a thesis project around a gravel sorting line.' },
    { q: 'Which PLCs and protocols are supported?', a: 'The edge gateway reads Modbus TCP, Siemens S7 (S7comm) and OPC UA. Factory I/O works through its Modbus TCP server driver. A built-in simulator covers demos without hardware.' },
    { q: 'How do I use it with Factory I/O?', a: 'In Factory I/O choose the Modbus TCP/IP Server driver and note its port (502). In the console, add a gateway, add a Modbus data source pointing at the Factory I/O machine, and apply the "Factory I/O - Sorting" template.' },
    { q: 'Can the console write to my PLC?', a: 'Only through supervised commands: the tag must be writable, your role must allow it, the value must be inside its range, and you confirm the write. AI-initiated writes are a separate switch that is off by default.' },
    { q: 'Where is my data stored?', a: 'In your own PostgreSQL. The whole stack is self-hosted with Docker Compose; nothing is sent to a third party unless you configure it (for example a model server).' },
    { q: 'How do people sign in?', a: 'Through Keycloak: email and password, company SSO, or Google when an admin enables it. An organisation admin can require MFA.' },
  ],
  faqMore: 'Still have a question?', faqMoreLink: 'Read the connection guide.',
  foot: [
    { h: 'Platform', links: [{ t: 'Overview', href: '#features' }, { t: 'Alarms', href: '#features' }, { t: 'Vision AI', href: '#features' }, { t: 'Commands', href: '#features' }] },
    { h: 'Connect', links: [{ t: 'Simulator', href: '#connect' }, { t: 'Factory I/O', href: '#connect' }, { t: 'Modbus / S7 / OPC UA', href: '#connect' }] },
    { h: 'Resources', links: [{ t: 'Use cases', href: '#use-cases' }, { t: 'FAQ', href: '#faq' }, { t: 'Status', href: '/status' }] },
    { h: 'Account', links: [{ t: 'Log in', href: '/signin' }, { t: 'Request access', href: '/signin' }] },
  ],
  made: 'Built for plant floors in Thailand', rights: 'vissointan · thesis project', tz: 'Bangkok time',
};

const TH: Copy = {
  ...EN,
  ticker: [
    { b: 'Aggregate AI:', t: 'แยกกรวด/ทรายรายคันรถจากกล้อง CCTV แล้วสั่ง PLC ผ่านเส้นทางที่มีการตรวจสอบเท่านั้น (ทดลองก่อนเขียนจริงจนกว่าคุณจะเปิด)' },
    { b: 'รองรับ Factory I/O:', t: 'เทมเพลต Modbus คลิกเดียว ได้ทั้งแท็ก แดชบอร์ด และกฎแจ้งเตือน' },
    { b: 'Derived tags:', t: 'สร้างสัญญาณคำนวณด้วยสูตรที่ปลอดภัย ประมวลผลฝั่งเซิร์ฟเวอร์' },
    { b: 'Zero-trust edge:', t: 'MQTT ผ่าน TLS ตัวตนแยกรายอุปกรณ์ พร้อม ACL บนโบรกเกอร์' },
  ],
  nav: [
    {
      id: 'platform', label: 'แพลตฟอร์ม',
      items: [
        { t: 'ภาพรวมแบบสด', d: 'KPI สถานะการเดินเครื่อง และการแจ้งเตือนของไลน์', href: '#features' },
        { t: 'แจ้งเตือนและเหตุการณ์', d: 'สถานะชัดเจน: เกิดขึ้น รับทราบ แก้ไขแล้ว', href: '#features' },
        { t: 'Vision AI', d: 'โมเดลกล้องจำแนกวัสดุบนสายพาน', href: '#features' },
        { t: 'สั่งงานแบบมีผู้ควบคุม', d: 'เขียนค่าไป PLC พร้อมยืนยัน ตรวจช่วงค่า และบันทึก audit', href: '#features' },
      ],
    },
    {
      id: 'connect', label: 'การเชื่อมต่อ',
      items: [
        { t: 'ตัวจำลองในระบบ', d: 'ไลน์เดโมที่ทำงานจริงโดยไม่ต้องมีฮาร์ดแวร์', href: '#connect' },
        { t: 'Factory I/O', d: 'เทมเพลต Modbus TCP สำหรับฉากคัดแยก', href: '#connect' },
        { t: 'PLC จริง', d: 'Modbus TCP, Siemens S7 และ OPC UA ผ่าน edge gateway', href: '#connect' },
      ],
    },
    {
      id: 'resources', label: 'แหล่งข้อมูล',
      items: [
        { t: 'เริ่มต้นใช้งาน', d: 'สี่ขั้นตอนตั้งแต่เข้าสู่ระบบจนเห็นข้อมูลสด', href: '#connect' },
        { t: 'กรณีใช้งาน', d: 'งานที่ระบบตอบโจทย์ได้วันนี้', href: '#use-cases' },
        { t: 'คำถามที่พบบ่อย', d: 'ความปลอดภัย โปรโตคอล และการติดตั้ง', href: '#faq' },
      ],
    },
  ],
  login: 'เข้าสู่ระบบ', start: 'เริ่มใช้งาน',
  h1a: 'คอนโซลควบคุมการผลิต',
  h1b: 'สำหรับไลน์ผลิตจริง',
  subPre: 'ดูไลน์ผลิตเป็น', chips: ['ดิจิทัลทวินสด', 'vision AI', 'การแจ้งเตือน'], subPost: 'และสั่งงานได้จากเบราว์เซอร์แท็บเดียว',
  ctaPrimary: 'เข้าสู่คอนโซล', ctaSecondary: 'วิธีเชื่อมต่อโรงงาน',
  twin: {
    title: 'ดิจิทัลทวินไลน์คัดแยก: มอเตอร์ สายพาน กล้อง vision และถังสองใบ',
    motor: 'มอเตอร์ · 58 Hz', vision: 'VISION AI', gravel: 'ถัง A · กรวด', sand: 'ถัง B · ทราย',
    counted: 'คัดแยกแล้วในรอบนี้', hint: 'ขยับเมาส์เพื่อหมุนมุมมอง',
  },
  protoLabel: 'คุยภาษาเดียวกับอุปกรณ์ที่มีอยู่แล้วในโรงงาน',
  approachH: 'จากแท็ก PLC ถึงการตัดสินใจ ในคอนโซลเดียว',
  approachP: 'โรงงานส่วนใหญ่ใช้ HMI สำหรับผู้ควบคุม historian สำหรับวิศวกร และสเปรดชีตสำหรับผู้จัดการ vissointan รวมค่าสด ประวัติ การแจ้งเตือน คำแนะนำจาก AI และการสั่งงานไว้บนแท็กชุดเดียวกัน ทุกคนจึงเห็นข้อมูลเดียวกัน',
  rows: [
    { ...EN.rows[0], title: 'เห็นทั้งไลน์ในหน้าเดียว', body: 'หน้าภาพรวมอ่านค่าจาก live store ทุกการ์ดแสดงค่า หน่วย กราฟย่อ และคุณภาพข้อมูล ค่าที่ค้างหรือเสียจะถูกทำเครื่องหมาย ไม่ถูกซ่อน', points: ['สถานะการเดินเครื่องพร้อมเวลาอัปเดตล่าสุด', 'เส้นลิมิตวาดอยู่หลังกราฟ', 'แสดงโครงร่างจนกว่าข้อมูลจริงจะมา ไม่หลอกว่าทุกอย่างปกติ'] },
    { ...EN.rows[1], title: 'การแจ้งเตือนที่เชื่อถือได้', body: 'กฎแบบ threshold, rate และ derived tag สร้างการแจ้งเตือนที่มีสถานะชัดเจน รายการวิกฤตจะค้างอยู่ด้านบนจนกว่าจะมีคนรับทราบ', points: ['ระดับความรุนแรงบอกทั้งสี ไอคอน และข้อความ', 'Shelving, downtime และรายงานคุณภาพการแจ้งเตือน', 'แจ้งเตือนเข้ามือถือด้วย Web Push'] },
    { ...EN.rows[2], title: 'AI เสนอ ผู้ควบคุมอนุมัติ', body: 'ตัวตรวจจับความผิดปกติและการ drift สร้าง insight พร้อมหลักฐาน โมเดล vision จำแนกวัสดุบนสายพาน ไม่มีคำสั่งใดถึง PLC โดยไม่ผ่านเส้นทางเขียนค่าที่มีการตรวจสอบ', points: ['ทุก insight มีหลักฐานและคะแนน', 'ตัดสินกรวด/ทรายรายคันรถ', 'ต่อ model server ของคุณเองได้'] },
    { ...EN.rows[3], title: 'ประวัติข้อมูลที่ query ได้จริง', body: 'Historian บน PostgreSQL แบ่งพาร์ทิชันรายเดือน และสรุปราย 1 นาที / 1 ชั่วโมง หน้า trend, notebook และ query อ่านจากตารางเดียวกัน', points: ['กราฟซูมได้พร้อมแถบแจ้งเตือน', 'ส่งออกเป็น CSV', 'คำนวณ SLO และ OEE จากข้อมูลชุดเดียวกัน'] },
    { ...EN.rows[4], title: 'สั่งงานพร้อมระบบกันพลาด', body: 'การตั้งค่า setpoint และสั่งเดิน/หยุด ต้องผ่านการตรวจสิทธิ์ ช่วงค่า อัตราการสั่ง และการยืนยัน แล้วถูกบันทึกใน audit trail แบบโซ่แฮช', points: ['สิทธิ์สั่งงานแยกตามพื้นที่', 'เขียนค่าได้ทีละคำสั่งต่อแท็ก', 'ทุกคำสั่งบันทึกว่าใคร ทำอะไร เพราะอะไร'] },
  ],
  ethos: [
    { ...EN.ethos[0], tag: 'เปิดตั้งแต่การออกแบบ', h: 'โปรโตคอลมาตรฐาน ข้อมูลเป็นของคุณ ไม่ผูกขาด', p: 'แท็กมาจากโปรโตคอลที่ PLC ใช้อยู่แล้ว ประวัติเก็บใน PostgreSQL ธรรมดา และทุกหน้ามี API รองรับ', list: ['Modbus TCP, Siemens S7 และ OPC UA ผ่าน edge gateway ตัวเดียว', 'ติดตั้งเองด้วย Docker Compose', 'REST API พร้อม API key แบบจำกัดสิทธิ์'] },
    { ...EN.ethos[1], tag: 'ปลอดภัยตั้งแต่ edge ถึงเบราว์เซอร์', h: 'Zero-trust ตั้งแต่ gateway ขึ้นมา', p: 'แต่ละ gateway มีตัวตนของตัวเองและส่งข้อมูลได้เฉพาะ topic ของตัวเอง ผู้ใช้เข้าสู่ระบบผ่าน Keycloak เปิด MFA ได้', list: ['MQTT ผ่าน TLS พร้อม ACL รายอุปกรณ์', 'Row-level security แยกองค์กรใน Postgres', 'บทบาท: owner, admin, operator, viewer'] },
  ],
  connectH: 'เชื่อมต่อโรงงานของคุณ', connectEm: 'ใน 4 ขั้นตอน',
  connectP: 'เริ่มจากตัวจำลอง ซ้อมกับ Factory I/O แล้วชี้ gateway ตัวเดิมไปที่ PLC จริง หลังเข้าสู่ระบบ คอนโซลจะพาทำทีละขั้น',
  steps: [
    { n: '01', t: 'เข้าสู่ระบบและเลือกไซต์', d: 'ใช้ SSO ของบริษัท, Google หรือบัญชีที่ผู้ดูแลสร้างให้ (ไม่มีการสมัครเอง) ไซต์เดโมมีไลน์จำลองทำงานอยู่แล้ว', where: '/signin' },
    { n: '02', t: 'เพิ่ม edge gateway', d: 'เมนู Infrastructure → Add device จะให้รหัส enrol แบบใช้ครั้งเดียว นำไปเปิดคอนเทนเนอร์ edge-bridge ข้าง PLC', where: 'Infrastructure → Add device' },
    { n: '03', t: 'เพิ่มแหล่งข้อมูลและแท็ก', d: 'เลือก Modbus TCP, Siemens S7 หรือ OPC UA ถ้าใช้ Factory I/O ให้กดเทมเพลต "Factory I/O - Sorting" ได้แท็ก แดชบอร์ด และกฎแจ้งเตือนในคลิกเดียว', where: 'Infrastructure → Data sources' },
    { n: '04', t: 'ดู แจ้งเตือน สั่งงาน', d: 'ค่าจะขึ้นในหน้าภาพรวมภายในหนึ่งวินาที เพิ่มกฎแจ้งเตือน เชิญทีม และเปิดการสั่งงานเมื่อพร้อม', where: 'Overview' },
  ],
  ucH: 'กรณีใช้งาน', ucEm: 'งานที่ใช้ได้วันนี้',
  uc: [
    { ...EN.uc[0], t: 'คัดแยกมวลรวม: กรวด กับ ทราย', d: 'กล้อง CCTV เหนือจุดเทจำแนกวัสดุรายคันรถ ผลการตัดสินถูกเขียนไป PLC ผ่านเส้นทางเดียวกับกฎอื่นๆ ที่มีการตรวจสอบ' },
    { ...EN.uc[1], t: 'ฝึกอบรมและทดสอบระบบด้วย Factory I/O', d: 'นักศึกษาและ integrator พัฒนากับโรงงานเสมือนผ่าน Modbus TCP แล้วสลับไปใช้ PLC จริงโดยไม่ต้องแก้แดชบอร์ดหรือการแจ้งเตือน' },
    { ...EN.uc[2], t: 'มอนิเตอร์ระยะไกลสำหรับโรงงานขนาดเล็ก', d: 'หนึ่ง gateway ต่อหนึ่งไซต์ หนึ่งคอนโซลสำหรับทั้งทีม แจ้งเตือนเข้ามือถือของคนที่เข้าเวร' },
  ],
  stackH: 'สร้างบน', stackEm: 'เทคโนโลยีเปิดที่พิสูจน์แล้ว',
  stackP: 'ไม่มีอะไรปิดซ่อนระหว่าง PLC กับเบราว์เซอร์ของคุณ',
  startH: 'พร้อมดูของจริงหรือยัง?',
  startP: 'เข้าสู่ระบบแล้วจะเห็นไลน์เดโมทำงานอยู่ เชื่อมต่ออุปกรณ์ของคุณเองเมื่อพร้อม',
  startBtn: 'เข้าสู่ระบบ', startGhost: 'คู่มือการเชื่อมต่อ',
  tokenPh: 'Access token', tokenEnter: 'เข้า', tokenBusy: 'กำลังเข้าสู่ระบบ…', tokenErr: 'token นี้ใช้ไม่ได้ ตรวจสอบแล้วลองอีกครั้ง',
  startR: 'ใช้ stack สำหรับนักพัฒนา? วาง dev token เพื่อข้ามหน้า login ได้', startRBtn: 'ไปหน้าเข้าสู่ระบบ',
  faqH: 'คำถามที่พบบ่อย',
  faq: [
    { q: 'vissointan คืออะไร?', a: 'คอนโซลควบคุมการผลิตบนเว็บ: ค่าสด มุมมองไลน์ 3D และ 2D การแจ้งเตือน ประวัติข้อมูล AI insight โมเดล vision และการสั่งงานแบบมีผู้ควบคุม ทั้งหมดอยู่บนโมเดลแท็กเดียวกัน เริ่มจากโปรเจกต์วิทยานิพนธ์ไลน์คัดแยกกรวด' },
    { q: 'รองรับ PLC และโปรโตคอลอะไรบ้าง?', a: 'Edge gateway อ่าน Modbus TCP, Siemens S7 (S7comm) และ OPC UA ได้ Factory I/O ใช้งานผ่านไดรเวอร์ Modbus TCP Server และมีตัวจำลองในระบบสำหรับเดโมที่ไม่มีฮาร์ดแวร์' },
    { q: 'ใช้กับ Factory I/O อย่างไร?', a: 'ใน Factory I/O เลือกไดรเวอร์ Modbus TCP/IP Server และจดพอร์ต (502) ในคอนโซลให้เพิ่ม gateway เพิ่มแหล่งข้อมูล Modbus ที่ชี้ไปเครื่อง Factory I/O แล้วกดเทมเพลต "Factory I/O - Sorting"' },
    { q: 'คอนโซลเขียนค่าไป PLC ได้ไหม?', a: 'ได้เฉพาะผ่านการสั่งงานแบบมีผู้ควบคุม: แท็กต้องเขียนได้ บทบาทต้องมีสิทธิ์ ค่าต้องอยู่ในช่วง และต้องกดยืนยัน การเขียนค่าโดย AI เป็นสวิตช์แยกที่ปิดไว้เป็นค่าเริ่มต้น' },
    { q: 'ข้อมูลเก็บไว้ที่ไหน?', a: 'ใน PostgreSQL ของคุณเอง ทั้งระบบติดตั้งเองด้วย Docker Compose ไม่มีข้อมูลส่งออกไปบุคคลที่สามเว้นแต่คุณตั้งค่าเอง (เช่น model server)' },
    { q: 'ผู้ใช้เข้าสู่ระบบอย่างไร?', a: 'ผ่าน Keycloak: อีเมลและรหัสผ่าน, SSO ของบริษัท หรือ Google เมื่อแอดมินเปิดใช้ องค์กรบังคับใช้ MFA ได้' },
  ],
  faqMore: 'ยังมีคำถาม?', faqMoreLink: 'อ่านคู่มือการเชื่อมต่อ',
  foot: [
    { h: 'แพลตฟอร์ม', links: [{ t: 'ภาพรวม', href: '#features' }, { t: 'การแจ้งเตือน', href: '#features' }, { t: 'Vision AI', href: '#features' }, { t: 'การสั่งงาน', href: '#features' }] },
    { h: 'การเชื่อมต่อ', links: [{ t: 'ตัวจำลอง', href: '#connect' }, { t: 'Factory I/O', href: '#connect' }, { t: 'Modbus / S7 / OPC UA', href: '#connect' }] },
    { h: 'แหล่งข้อมูล', links: [{ t: 'กรณีใช้งาน', href: '#use-cases' }, { t: 'คำถามที่พบบ่อย', href: '#faq' }, { t: 'สถานะระบบ', href: '/status' }] },
    { h: 'บัญชี', links: [{ t: 'เข้าสู่ระบบ', href: '/signin' }, { t: 'ขอสิทธิ์เข้าใช้', href: '/signin' }] },
  ],
  made: 'สร้างเพื่อโรงงานในประเทศไทย', rights: 'vissointan · โปรเจกต์วิทยานิพนธ์', tz: 'เวลากรุงเทพฯ',
};

const PROTOCOLS = [
  { name: 'Modbus TCP', logo: '/logos/modbus.png' },
  { name: 'Siemens S7' },
  { name: 'OPC UA' },
  { name: 'MQTT · TLS', logo: '/logos/mqtt.svg' },
  { name: 'Factory I/O' },
  { name: 'WebSocket', logo: '/logos/websocket.svg' },
];
const STACK = [
  { name: 'React', logo: '/logos/react.svg' },
  { name: 'three.js', logo: '/logos/threedotjs.svg' },
  { name: 'FastAPI', logo: '/logos/fastapi.svg' },
  { name: 'PostgreSQL', logo: '/logos/postgresql.svg' },
  { name: 'Mosquitto', logo: '/logos/eclipsemosquitto.svg' },
  { name: 'Keycloak', logo: '/logos/keycloak.svg' },
  { name: 'Docker', logo: '/logos/docker.svg' },
  { name: 'Python', logo: '/logos/python.svg' },
];

/* ---------- primitives ---------------------------------------------------- */
function HxBtn({ children, variant, className = '', ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'lg' | 'ghost' }) {
  return (
    <button {...rest} className={`cs-btn ${variant ? `cs-btn-${variant}` : ''} ${className}`}>
      <span className="cs-corners" aria-hidden><i /><i /><i /><i /></span>
      <span className="cs-btn-label">{children}</span>
    </button>
  );
}
function HxLink({ children, variant, className = '', to, ...rest }:
  React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: 'lg' | 'ghost' | 'sm'; to?: string }) {
  const inner = (
    <>
      <span className="cs-corners" aria-hidden><i /><i /><i /><i /></span>
      <span className="cs-btn-label">{children}</span>
    </>
  );
  const cls = `cs-btn ${variant ? `cs-btn-${variant}` : ''} ${className}`;
  return to ? <Link to={to} className={cls}>{inner}</Link> : <a {...rest} className={cls}>{inner}</a>;
}

/** anchor or router link, depending on the target */
function Go({ href, className, children, onClick }: { href: string; className?: string; children: React.ReactNode; onClick?: () => void }) {
  return href.startsWith('#')
    ? <a href={href} className={className} onClick={onClick}>{children}</a>
    : <Link to={href} className={className} onClick={onClick}>{children}</Link>;
}

function NavDrop({ menu, open, onOpen, onClose }: {
  menu: Copy['nav'][number]; open: boolean; onOpen: () => void; onClose: () => void;
}) {
  return (
    <div className="cs-dd" onMouseEnter={onOpen} onMouseLeave={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <button type="button" className={`cs-navlink cs-dd-btn${open ? ' is-open' : ''}`}
        aria-expanded={open} aria-haspopup="true"
        onClick={() => (open ? onClose() : onOpen())} onFocus={onOpen}>
        {menu.label}<HxIcon d={I.chevron} size={11} className="cs-dd-chev" />
      </button>
      {open && (
        <div className="cs-dd-panel" role="menu">
          {menu.items.map((it) => (
            <a key={it.t} href={it.href} className="cs-dd-item" role="menuitem" onClick={onClose}>
              <span><b>{it.t}</b><small>{it.d}</small></span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** probe once: can this browser make a WebGL context at all? */
function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** theme by the Thai clock — paper 06:00–18:00 ICT, ink at night */
function thaiNight(): boolean {
  const h = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false,
  }).format(new Date()));
  return h < 6 || h >= 18;
}

export function Landing() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const th = i18n.language === 'th';
  const c = th ? TH : EN;
  const cfg = authConfig();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [menu, setMenu] = useState(false);
  const [dd, setDd] = useState<string | null>(null);
  const [faq, setFaq] = useState<number | null>(0);
  const [gl] = useState(hasWebGL);
  const [counts, setCounts] = useState<[number, number]>([0, 0]);
  const ddTimer = useRef<number | undefined>(undefined);
  const openDd = (k: string) => { window.clearTimeout(ddTimer.current); setDd(k); };
  const closeDd = () => {
    window.clearTimeout(ddTimer.current);
    ddTimer.current = window.setTimeout(() => setDd(null), 140);
  };
  useEffect(() => () => window.clearTimeout(ddTimer.current), []);

  const [dark, setDark] = useState(thaiNight);
  useEffect(() => {
    const id = window.setInterval(() => setDark(thaiNight()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  /* footer clock (ICT) */
  const [clock, setClock] = useState('');
  useEffect(() => {
    const f = () => setClock(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(new Date()));
    f();
    const id = window.setInterval(f, 1000);
    return () => window.clearInterval(id);
  }, []);

  /* scroll reveal — one IO, opacity/translate only */
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('[data-reveal]'));
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('cs-in'));
      return;
    }
    const io = new IntersectionObserver((ents) => {
      ents.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('cs-in'); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [th]);

  /** validate token against /api/me before sign-in (unchanged auth flow) */
  const enter = async () => {
    const tok = token.trim();
    if (!tok || busy) return;
    setBusy(true);
    setSessionToken(tok);
    try {
      await api.me();
      signIn(tok);
      navigate('/');
    } catch {
      setSessionToken('');
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const langToggle = (
    <span className="vz-lang" role="group" aria-label="Language">
      <button type="button" lang="en" aria-pressed={!th} onClick={() => setLang('en')}>EN</button>
      <button type="button" lang="th" aria-pressed={th} onClick={() => setLang('th')}>TH</button>
    </span>
  );

  return (
    <div className={`landing-root${dark ? ' hx-dark' : ''}`} lang={th ? 'th' : 'en'}>
      <div className="cs-noise" aria-hidden />
      <div className="cs-rail cs-rail-l" aria-hidden />
      <div className="cs-rail cs-rail-r" aria-hidden />

      {/* ---------- announcement ticker ---------- */}
      <div className="cs-ticker cs-marks" role="group" aria-label="Announcements">
        <i className="m-bl" aria-hidden /><i className="m-br" aria-hidden />
        <div className="cs-ticker-track">
          {[0, 1].map((n) => (
            <div key={n} className="cs-ticker-set" aria-hidden={n === 1}>
              {c.ticker.map((it) => (
                <a key={it.b} href="#features" className="cs-tick">
                  <b>{it.b}</b>&nbsp;{it.t}
                  <i className="cs-tick-arrow"><HxIcon d={I.arrowR} size={9} /></i>
                </a>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ---------- nav ---------- */}
      <nav className="cs-nav">
        <div className="cs-nav-l">
          <NavDrop menu={c.nav[0]} open={dd === 'platform'} onOpen={() => openDd('platform')} onClose={closeDd} />
          <NavDrop menu={c.nav[1]} open={dd === 'connect'} onOpen={() => openDd('connect')} onClose={closeDd} />
          <a href="#use-cases" className="cs-navlink">{c.ucH}</a>
        </div>
        <Link to="/" className="cs-logo vz-logo"><img src="/logo-192.png" alt="" />vissointan</Link>
        <div className="cs-nav-r">
          <NavDrop menu={c.nav[2]} open={dd === 'resources'} onOpen={() => openDd('resources')} onClose={closeDd} />
          {langToggle}
          <Link to="/signin" className="cs-login">{c.login}</Link>
          <HxLink to="/signin" variant="sm" className="cs-nav-cta">{c.start}</HxLink>
          <button className="cs-burger" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <span /><span />
          </button>
        </div>
      </nav>

      {menu && (
        <div className="cs-mnav" role="dialog" aria-modal="true">
          <div className="cs-mnav-head">
            <span className="cs-logo vz-logo"><img src="/logo-192.png" alt="" />vissointan</span>
            <button className="cs-burger is-x" aria-label="Close" onClick={() => setMenu(false)}>✕</button>
          </div>
          <div className="cs-mnav-scroll">
            {c.nav.map((m) => (
              <div key={m.id} className="cs-mnav-group">
                <div className="cs-dd-eyebrow">{m.label}</div>
                {m.items.map((it) => (
                  <a key={it.t} href={it.href} className="cs-mnav-item" onClick={() => setMenu(false)}>
                    <span>{it.t}</span>
                  </a>
                ))}
              </div>
            ))}
            <div className="cs-mnav-group">
              {langToggle}
              <Link to="/signin" className="cs-mnav-item" onClick={() => setMenu(false)}><span>{c.login}</span></Link>
            </div>
          </div>
        </div>
      )}

      {/* ---------- hero ---------- */}
      <header className="hx-hero">
        <div className="hx-hero-bg" aria-hidden>
          <div className="hx-hero-grid-bg" />
          <div className="hx-hero-fade" />
        </div>
        <div className="hx-hero-inner">
          <h1 className="hx-h1" data-reveal>
            <Sparkle />
            {c.h1a}<br />
            <em>{c.h1b}</em>
          </h1>
          <p className="hx-hero-sub" data-reveal>
            {c.subPre}{' '}
            <a href="#features" className="hx-chip"><i className="hx-chip-spot c-teal"><HxIcon d={I.cube} size={12} /></i>{c.chips[0]}</a>{' '}
            <a href="#features" className="hx-chip"><i className="hx-chip-spot c-rose"><HxIcon d={I.eye} size={12} /></i>{c.chips[1]}</a>{' '}
            <a href="#features" className="hx-chip"><i className="hx-chip-spot c-blue"><HxIcon d={I.bell} size={12} /></i>{c.chips[2]}</a>{' '}
            {c.subPost}
          </p>
          <div className="hx-hero-cta" data-reveal>
            <HxLink to="/signin">{c.ctaPrimary}</HxLink>
            <HxLink href="#connect" variant="ghost">{c.ctaSecondary}</HxLink>
          </div>

          {/* the twin stage — three.js over a vector fallback */}
          <figure className="vz-stage cs-marks" data-reveal>
            <i className="m-tl" aria-hidden /><i className="m-tr" aria-hidden />
            <i className="m-bl" aria-hidden /><i className="m-br" aria-hidden />
            <div className="vz-stage-art">
              <HeroVector title={c.twin.title} />
              {gl && (
                <TwinBoundary>
                <Suspense fallback={null}>
                  <HeroLine3D
                    key={dark ? 'night' : 'day'} /* re-read the theme colours */
                    labels={{ motor: c.twin.motor, vision: c.twin.vision, gravel: c.twin.gravel, sand: c.twin.sand }}
                    onCount={(g, s) => setCounts([g, s])}
                  />
                </Suspense>
                </TwinBoundary>
              )}
            </div>
            <figcaption className="vz-stage-bar mono">
              <span className="vz-live"><i aria-hidden />LIVE · SORT LINE 1</span>
              <span>{c.twin.gravel}: <b>{counts[0]}</b></span>
              <span>{c.twin.sand}: <b>{counts[1]}</b></span>
              <span className="vz-stage-hint">{gl ? c.twin.hint : c.twin.counted}</span>
            </figcaption>
          </figure>
        </div>
      </header>

      {/* ---------- protocols strip ---------- */}
      <section className="cs-trust cs-marks" data-reveal>
        <i className="m-tl" aria-hidden /><i className="m-tr" aria-hidden />
        <i className="m-bl" aria-hidden /><i className="m-br" aria-hidden />
        <p className="cs-trust-label mono">
          <i className="cs-cap cs-cap-l" aria-hidden />
          {c.protoLabel}
          <i className="cs-cap cs-cap-r" aria-hidden />
        </p>
        <div className="vz-proto">
          {PROTOCOLS.map((p) => (
            <div key={p.name} className="vz-proto-cell">
              {p.logo && <img src={p.logo} alt="" loading="lazy" />}
              <span className="mono">{p.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- approach ---------- */}
      <section className="cs-sec hx-approach" id="features">
        <h2 className="cs-h2" data-reveal>{c.approachH}</h2>
        <p className="cs-sub2" data-reveal>{c.approachP}</p>
      </section>

      {/* ---------- feature rows with real console screenshots ---------- */}
      <section className="hx-rows">
        {c.rows.map((r) => (
          <div key={r.id} className={`hx-row${r.flip ? ' is-flip' : ''}`} data-reveal>
            <div className="hx-row-copy">
              <i className="hx-row-icon" aria-hidden><HxIcon d={I[r.icon]} size={26} /></i>
              <h3>{r.title}</h3>
              <p className="vz-row-body">{r.body}</p>
              <ul className="vz-points">
                {r.points.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </div>
            <div className="hx-row-art">
              <div className="vz-shot">
                <div className="vz-shot-bar" aria-hidden><i /><i /><i /><span className="mono">vissointan · {r.id}</span></div>
                <img src={r.img} alt={r.alt} loading="lazy" />
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* ---------- ethos pair ---------- */}
      <section className="cs-sec hx-ethos" id="ethos">
        <div className="hx-ethos-grid">
          {c.ethos.map((e, i) => (
            <div key={e.tag} className="hx-ethos-card" data-reveal>
              <span className={`hx-tag mono hx-tag-${e.cls}`}>{e.tag}</span>
              <i className="vz-ethos-ic" aria-hidden><HxIcon d={i === 0 ? I.plug : I.shield} size={28} /></i>
              <h3>{e.h}</h3>
              <p>{e.p}</p>
              <ul>{e.list.map((li) => <li key={li}>{li}</li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- connect your plant ---------- */}
      <section className="cs-sec vz-connect" id="connect">
        <h2 className="cs-h2" data-reveal>{c.connectH}<br /><em>{c.connectEm}</em></h2>
        <p className="cs-sub2" data-reveal>{c.connectP}</p>
        <ol className="vz-steps cs-marks" data-reveal>
          <i className="m-tl" aria-hidden /><i className="m-tr" aria-hidden />
          <i className="m-bl" aria-hidden /><i className="m-br" aria-hidden />
          {c.steps.map((s) => (
            <li key={s.n} className="vz-step">
              <span className="vz-step-n mono">{s.n}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
              <span className="vz-step-where mono">{s.where}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- use cases ---------- */}
      <section className="cs-sec hx-uc" id="use-cases">
        <div className="hx-uc-inner" data-reveal>
          <div className="hx-uc-head">
            <h2 className="hx-uc-h2"><span>{c.ucH}</span><em>{c.ucEm}</em></h2>
          </div>
          <div className="hx-uc-rows">
            {c.uc.map((u) => (
              <a key={u.t} href="#connect" className="hx-uc-row">
                <i className="hx-uc-ic" aria-hidden><HxIcon d={I[u.ic]} size={20} /></i>
                <div className="hx-uc-txt">
                  <h3>{u.t}</h3>
                  <p>{u.d}</p>
                </div>
                <HxIcon d={I.arrowTR} size={15} className="hx-uc-arrow" />
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- built on ---------- */}
      <section className="cs-sec hx-int" id="stack">
        <h2 className="cs-h2" data-reveal>{c.stackH}<br /><em>{c.stackEm}</em></h2>
        <p className="cs-sub2" data-reveal>{c.stackP}</p>
        <div className="vz-stack" data-reveal>
          {STACK.map((s) => (
            <div key={s.name} className="vz-stack-cell">
              <img src={s.logo} alt="" loading="lazy" />
              <span className="mono">{s.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- getting started + token wall ---------- */}
      <section className="hx-start" id="enter">
        <div className="hx-start-row" data-reveal>
          <div className="hx-start-l">
            <h3>{c.startH}</h3>
            <p>{c.startP}</p>
            <div className="hx-start-btns">
              <HxLink to="/signin">{c.startBtn}</HxLink>
              <HxLink href="#connect" variant="ghost">{c.startGhost}</HxLink>
            </div>
          </div>
          <div className="hx-start-r">
            {cfg?.dev_tokens ? (
              <>
                <p>{c.startR}</p>
                <form className="cs-token" onSubmit={(e) => { e.preventDefault(); void enter(); }}>
                  <input
                    value={token}
                    onChange={(e) => { setToken(e.target.value); setFailed(false); }}
                    placeholder={c.tokenPhDev}
                    aria-label={c.tokenPh} autoComplete="off" spellCheck={false}
                  />
                  <HxBtn type="submit" disabled={!token.trim() || busy}>{busy ? c.tokenBusy : c.tokenEnter}</HxBtn>
                </form>
                {failed && <p className="cs-token-err" role="alert">{c.tokenErr}</p>}
              </>
            ) : (
              <>
                <p>{c.startP}</p>
                <HxLink to="/signin" variant="ghost">{c.startRBtn}</HxLink>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="cs-sec cs-faq" id="faq">
        <h2 className="cs-h2" data-reveal>{c.faqH}</h2>
        <div className="cs-faq-list" data-reveal>
          {c.faq.map((f, i) => (
            <div key={f.q} className={`cs-faq-item${faq === i ? ' is-open' : ''}`}>
              <h3>
                <button type="button" aria-expanded={faq === i} onClick={() => setFaq(faq === i ? null : i)}>
                  <span>{f.q}</span>
                  <HxIcon d={I.chevron} size={15} className="cs-faq-chev" />
                </button>
              </h3>
              {faq === i && <div className="cs-faq-a"><p>{f.a}</p></div>}
            </div>
          ))}
        </div>
        <p className="cs-faq-more">{c.faqMore} <a href="#connect">{c.faqMoreLink}</a></p>
      </section>

      {/* ---------- footer ---------- */}
      <footer className="cs-foot">
        <div className="cs-foot-inner">
          <div className="cs-foot-brand">
            <span className="cs-logo vz-logo"><img src="/logo-192.png" alt="" />vissointan</span>
            <span className="cs-foot-made mono">{c.made}</span>
            <span className="hx-clock mono" aria-label={c.tz}>{clock} ICT</span>
          </div>
          {c.foot.map((col) => (
            <div key={col.h} className="cs-foot-col">
              <h4 className="mono">{col.h}</h4>
              {col.links.map((l) => <Go key={l.t} href={l.href}>{l.t}</Go>)}
            </div>
          ))}
        </div>
        <div className="cs-foot-bottom">
          <span>© 2026 {c.rights}</span>
          <div>{langToggle}</div>
        </div>
      </footer>
    </div>
  );
}
