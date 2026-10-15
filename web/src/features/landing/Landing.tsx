// Landing — runtime-extracted Hex design system (web/DESIGN.md) carrying
// vissointan content: mono ticker marquee, centered-logo nav, corner-tick
// gradient buttons, gradient display headline over faint arc line-art,
// protocol marquee, bright product visuals on dark canvas, quote band,
// glyph-starfield "built" band, template grid, column footer.
// Marketing skin only — the console inside stays dd-light.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { signIn } from '../../app/session';
import { api, setSessionToken } from '../../lib/api';
import { LANGS, setLang } from '../../lib/i18n';
import { authConfig } from '../auth/oidc';
import { Icon, type IconName } from '../../shared/ui/Icon';
import './landing.css';

const TICKS = ['tick1', 'tick2', 'tick3', 'tick4', 'tick5'] as const;
const PROTOCOLS = ['MODBUS TCP', 'OPC UA', 'MQTT / TLS 1.3', 'SPARKPLUG B', 'OIDC SSO', 'WEBSOCKET', 'POSTGRESQL RLS', 'REST + WS API'];
const SPEC_KEYS = ['specIngest', 'specRealtime', 'specControl', 'specAuth', 'specAudit'] as const;

/** template cards — tpl1..6 copy + which line-art thumb each carries */
const TPLS: { k: string; art: 'flow' | 'mimic' | 'topic' | 'alarm' | 'cmd' | 'insight' }[] = [
  { k: 'tpl1', art: 'flow' }, { k: 'tpl2', art: 'mimic' }, { k: 'tpl3', art: 'topic' },
  { k: 'tpl4', art: 'alarm' }, { k: 'tpl5', art: 'cmd' }, { k: 'tpl6', art: 'insight' },
];

/** nav mega-menu model — i18n keys, anchors, icon glyphs (cf. Hex NavMenu) */
type DdItem = { k: string; icon: IconName; href: string };
type DdGroup = { eyebrow: string; items: DdItem[] };
const NAV_MENUS: { id: string; label: string; groups: DdGroup[]; promo: string }[] = [
  {
    id: 'console', label: 'landing.navConsole', promo: 'landing.ddPromo',
    groups: [
      {
        eyebrow: 'landing.navConsole',
        items: [
          { k: 'ddLive', icon: 'activity', href: '#caps' },
          { k: 'ddFlow', icon: 'waves', href: '#flow' },
          { k: 'ddGuard', icon: 'shield', href: '#guard' },
          { k: 'ddInsight', icon: 'sparkle', href: '#insight' },
        ],
      },
      {
        eyebrow: 'landing.navOps',
        items: [
          { k: 'ddAlarms', icon: 'alarm', href: '#guard' },
          { k: 'ddCmds', icon: 'commands', href: '#guard' },
          { k: 'ddTopics', icon: 'tag', href: '#spec' },
          { k: 'ddEdge', icon: 'plant', href: '#flow' },
        ],
      },
    ],
  },
  {
    id: 'resources', label: 'landing.navResources', promo: 'landing.ddPromo',
    groups: [
      {
        eyebrow: 'landing.navResources',
        items: [
          { k: 'ddSpec', icon: 'layers', href: '#spec' },
          { k: 'ddTemplates', icon: 'copy', href: '#templates' },
          { k: 'ddHealth', icon: 'health', href: '#caps' },
        ],
      },
      {
        eyebrow: 'landing.navAccess',
        items: [
          { k: 'ddSignin', icon: 'user', href: '#enter' },
          { k: 'ddAuth', icon: 'lock', href: '#spec' },
          { k: 'ddAudit', icon: 'eye', href: '#insight' },
        ],
      },
    ],
  },
];
const BADGES = ['badge1', 'badge2', 'badge3', 'badge4', 'badge5', 'badge6'] as const;

/** signature Hex-style button: gradient hairline + corner ticks on hover +
 *  orbiting dots at each side edge */
function Corner({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <span className="hx-corners" aria-hidden><i /><i /><i /><i /></span>
      <span className="hx-btn-label">{children}</span>
      <span className="hx-orbs" aria-hidden><i /><i /></span>
    </>
  );
}
function HxBtn({ children, variant, className = '', ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'lg' | 'ghost' }) {
  return (
    <button {...rest} className={`hx-btn ${variant ? `hx-btn-${variant}` : ''} ${className}`}>
      <Corner>{children}</Corner>
    </button>
  );
}
function HxLink({ children, variant, className = '', ...rest }:
  React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: 'lg' | 'ghost' | 'sm' }) {
  return (
    <a {...rest} className={`hx-btn ${variant ? `hx-btn-${variant}` : ''} ${className}`}>
      <Corner>{children}</Corner>
    </a>
  );
}

function Spark({ color = '#f5c0c0' }: { color?: string }) {
  return (
    <svg viewBox="0 0 126 40" preserveAspectRatio="none" aria-hidden>
      <polyline points="0,30 14,26 28,32 42,22 56,26 70,18 84,24 98,14 112,20 126,10"
        fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** faint arc line-art + glyph starfield behind the hero (cf. Hex hero bg) */
function HeroArt() {
  return (
    <svg className="hx-heroart" viewBox="0 0 1440 760" fill="none" aria-hidden>
      {/* large arcs rising off the top edge */}
      <circle cx="1210" cy="-40" r="330" stroke="#3a3138" strokeWidth="1" />
      <circle cx="1210" cy="-40" r="255" stroke="#3a3138" strokeWidth="1" opacity=".6" />
      <circle cx="180" cy="760" r="290" stroke="#3a3138" strokeWidth="1" />
      <circle cx="180" cy="760" r="215" stroke="#3a3138" strokeWidth="1" opacity=".6" />
      {/* tiny rect glyphs scattered — Hex's notebook-icon starfield */}
      {[
        [95, 180], [240, 90], [420, 150], [1120, 200], [1290, 120],
        [80, 460], [1350, 430], [300, 620], [1140, 620], [660, 120],
      ].map(([x, y]) => (
        <g key={`${x}${y}`} stroke="#4a3f47" strokeWidth="1" opacity=".55">
          <rect x={x} y={y} width="16" height="12" rx="1" />
          <line x1={x + 3} y1={y + 4} x2={x + 13} y2={y + 4} />
          <line x1={x + 3} y1={y + 8} x2={x + 10} y2={y + 8} />
        </g>
      ))}
      {/* small cross ticks */}
      {[[520, 60], [930, 80], [140, 300], [1330, 300], [760, 690]].map(([x, y]) => (
        <path key={`c${x}${y}`} d={`M${x} ${y}h10M${x + 5} ${y - 5}v10`} stroke="#4a3f47" strokeWidth="1" opacity=".5" />
      ))}
      {/* voronoi constellation — thin polygon mesh + nodes (cf. VoronoiWrapper) */}
      <g stroke="#332b33" strokeWidth="1" opacity=".7">
        <path d="M40 640 L200 520 L380 560 L300 700 L120 720 Z" />
        <path d="M200 520 L420 430 L380 560" />
        <path d="M420 430 L620 480 L380 560" />
        <path d="M620 480 L820 410 L900 560 L620 480" />
        <path d="M900 560 L1100 500 L1240 620 L1040 690 Z" />
        <path d="M1100 500 L1290 430 L1400 520 L1240 620" />
        <path d="M980 90 L1150 160 L1290 90" />
        <path d="M1150 160 L1330 240 L1420 140" />
        <path d="M60 90 L190 160 L320 110 L260 240 L110 260 Z" />
        <path d="M190 160 L360 240 L260 240" />
      </g>
      <g fill="#4a3f47">
        {[[200, 520], [420, 430], [620, 480], [900, 560], [1100, 500], [1290, 430], [190, 160], [1150, 160], [380, 560]].map(([x, y]) => (
          <circle key={`n${x}${y}`} cx={x} cy={y} r="2.4" />
        ))}
      </g>
    </svg>
  );
}

/** nav mega-menu — hover/focus opens a panel anchored to its trigger:
 *  grouped glyph items + eyebrow labels + promo card. Open/close are
 *  intent-delayed at the call site so the pointer can travel the bridge. */
function NavDrop({ menu, open, align, onOpen, onClose, t }: {
  menu: (typeof NAV_MENUS)[number]; open: boolean; align?: 'start' | 'end';
  onOpen: () => void; onClose: () => void;
  t: (k: string) => string;
}) {
  return (
    <div className={`hx-dd${align === 'end' ? ' hx-dd--end' : ''}`}
      onMouseEnter={onOpen} onMouseLeave={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <button type="button" className={`hx-navlink hx-dd-btn${open ? ' is-open' : ''}`}
        aria-expanded={open} aria-haspopup="true"
        onClick={() => (open ? onClose() : onOpen())} onFocus={onOpen}>
        {t(menu.label)}
        <Icon name="chevron-down" size={12} className="hx-dd-chev" />
      </button>
      {open && (
        <div className="hx-dd-panel" role="menu">
          <div className="hx-dd-cols">
            {menu.groups.map((g) => (
              <div key={g.eyebrow} className="hx-dd-col">
                <div className="hx-dd-eyebrow mono">{t(g.eyebrow)}</div>
                {g.items.map((it) => (
                  <a key={it.k} href={it.href} className="hx-dd-item" role="menuitem" onClick={onClose}>
                    <span className="hx-dd-icon"><Icon name={it.icon} size={15} /></span>
                    <span><b>{t(`landing.${it.k}`)}</b><small>{t(`landing.${it.k}D`)}</small></span>
                  </a>
                ))}
              </div>
            ))}
          </div>
          <a href="#enter" className="hx-dd-promo" onClick={onClose}>
            <span className="hx-dd-icon"><Icon name="play" size={15} /></span>
            <span><b>{t(menu.promo)}</b><small>{t(`${menu.promo}D`)}</small></span>
            <span className="hx-dd-go mono">{t('landing.ddPromoCta')} →</span>
          </a>
        </div>
      )}
    </div>
  );
}

/** BRIGHT overlapping code cells — Hex's white screenshot panels */
function HarmonyCells() {
  return (
    <div className="hx-cells">
      <div className="hx-cell hx-cell-a">
        <div className="hx-cell-bar">
          <i /><i /><i /><span>MQTT publish — edge</span>
          <b className="hx-cell-run"><Icon name="play" size={10} /></b>
        </div>
        <pre>{`pub "v2/acme/plant1/edge01/metrics"
    qos=1 retain=false

{ "belt_mm_s": 1.42,
  "quality": "GOOD",
  "ts": 1739800201.204 }`}</pre>
        <div className="hx-cell-out">✓ delivered — 8 ms</div>
      </div>
      <div className="hx-cell hx-cell-b">
        <div className="hx-cell-bar">
          <i /><i /><i /><span>WebSocket /ws — console</span>
          <b className="hx-cell-run"><Icon name="play" size={10} /></b>
        </div>
        <pre>{`{ "op": "telemetry",
  "seq": 40912,
  "topic": "v2/acme/plant1/…",`}<i className="hx-caret" /></pre>
        {/* floating autocomplete — like Hex's typeahead menu in-cell */}
        <div className="hx-ac">
          <div className="hx-ac-item is-sel"><b>topic</b><span>v2/acme/plant1/edge01/metrics</span></div>
          <div className="hx-ac-item"><b>tag</b><span>belt_mm_s · FLOAT</span></div>
          <div className="hx-ac-item"><b>tag</b><span>belt_temp_c · FLOAT</span></div>
        </div>
        <pre>{`  "v": 1.42, "q": "GOOD" }`}</pre>
        <div className="hx-cell-out">✓ streamed ≤ 2 s end-to-end</div>
      </div>
    </div>
  );
}

/** bright alarm/command card */
function GuardCard() {
  return (
    <div className="hx-guard">
      <div className="hx-alarm">
        <span className="hx-sev hx-sev-maj">MAJOR</span>
        <div><b>BIN-01 level high</b><span>plant1 · line1 · 14:02:11</span></div>
        <i className="hx-ack">ACK</i>
      </div>
      <div className="hx-alarm">
        <span className="hx-sev hx-sev-min">minor</span>
        <div><b>Belt drift +0.4%</b><span>insight · drift detector</span></div>
        <i className="hx-ack">ACK</i>
      </div>
      <div className="hx-cmd">
        <div className="hx-cmd-line mono">$ set belt_speed → <b>1.60 m/s</b></div>
        <div className="hx-cmd-steps" aria-hidden>
          {['issued', 'sent', 'acked', 'done'].map((s) => <i key={s}>{s}</i>)}
        </div>
        <div className="hx-cmd-confirm mono">type <b>CONFIRM</b> to write — PLC may still refuse</div>
      </div>
    </div>
  );
}

/** DAG panel — edge → broker → api → console; bright mini-cells ride the
 *  arcs like Hex's "Intelligent execution" (cells + dotted connectors) */
function DagPanel() {
  const arcs = [
    'M60 60 C 170 60, 170 150, 260 150', 'M60 240 C 170 240, 170 150, 260 150',
    'M260 150 C 340 150, 340 150, 460 90', 'M260 150 C 340 150, 340 210, 460 210',
  ];
  const cells = [
    { x: 4, y: 8, t: 'edge bridge', b: 'modbus read\nbatch 40 tags' },
    { x: 4, y: 68, t: 'plc · line1', b: 'holding regs\n40001–40040' },
    { x: 40, y: 38, t: 'mqtt · tls 8883', b: 'v2/acme/plant1/\n  edge01/metrics' },
    { x: 76, y: 12, t: 'rest api', b: 'GET /api/tags\n  → history' },
    { x: 76, y: 62, t: 'ws console', b: '{op:"telemetry"\n v:1.42 q:GOOD}' },
  ];
  return (
    <div className="hx-dag">
      <svg viewBox="0 0 520 300" fill="none" aria-hidden>
        {arcs.map((d) => <path key={d} d={d} stroke="#3a3138" strokeWidth="1" strokeDasharray="3 5" />)}
        {arcs.map((d) => <path key={`p${d}`} d={d} className="hx-dag-pulse" stroke="#f5c0c0" strokeWidth="1.5" strokeDasharray="6 140" />)}
        {[['60', '60'], ['60', '240'], ['260', '150'], ['460', '90'], ['460', '210']].map(([x, y]) => (
          <circle key={`${x}${y}`} cx={x} cy={y} r="5" stroke="#f5c0c0" opacity=".6" />
        ))}
      </svg>
      {cells.map((c) => (
        <div key={c.t} className="hx-dcell" style={{ left: `${c.x}%`, top: `${c.y}%` }}>
          <div className="hx-dcell-t mono">{c.t}</div>
          <pre className="mono">{c.b}</pre>
        </div>
      ))}
    </div>
  );
}

/** bright live-console mock for section 1 */
function LivePanel() {
  const { t } = useTranslation();
  return (
    <div className="hx-live">
      <div className="hx-live-bar"><i /><i /><i /><span>plant1 / line1 — live</span><b className="mono">RUNNING</b></div>
      <div className="hx-live-grid">
        <div className="hx-live-metric"><span>Belt speed</span><b>1.42 m/s</b><Spark /></div>
        <div className="hx-live-metric"><span>Belt temp</span><b>61.3 °C</b><Spark color="#ad8eb6" /></div>
        <div className="hx-live-metric"><span>Bin level</span><b>72 %</b>
          <div className="hx-bar"><i style={{ width: '72%' }} /></div>
        </div>
      </div>
      <div className="hx-live-row"><span className="dot ok" /> Conveyor RUN · quality GOOD · 14:02:11</div>
      {/* floating big-number card — cf. Hex's "520 MTD Customers" overlay */}
      <div className="hx-bignum">
        <b>99.2</b>
        <span className="mono">OEE % — line1</span>
        <em>↑ 4.1% {t('landing.vsYesterday')}</em>
      </div>
    </div>
  );
}

/** repeated glyph tile for the "built" band — one notebook glyph tiled
 *  via SVG pattern (cf. Hex's 102-icon field) */
function GlyphField() {
  return (
    <svg className="hx-glyphfield" aria-hidden>
      <defs>
        <pattern id="hx-glyph" width="88" height="88" patternUnits="userSpaceOnUse">
          <g stroke="#4a3f47" strokeWidth="1" fill="none" opacity=".8">
            <rect x="36" y="38" width="16" height="12" rx="1" />
            <line x1="39" y1="42" x2="49" y2="42" />
            <line x1="39" y1="46" x2="46" y2="46" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#hx-glyph)" />
    </svg>
  );
}

/** pennant badge for the "rated" card — chevron flag shape */
function Pennant({ label }: { label: string }) {
  return (
    <div className="hx-pennant">
      <svg viewBox="0 0 96 108" aria-hidden>
        <path d="M8 4 h80 v88 l-40 -18 -40 18 Z" fill="#1d1d29" stroke="#3a3138" />
        <path d="M8 4 h80 v88 l-40 -18 -40 18 Z" fill="none" stroke="#f5c0c0" strokeOpacity=".35" />
        <circle cx="48" cy="34" r="9" fill="none" stroke="#f5c0c0" />
        <path d="M44 34 l3 3 6-6" fill="none" stroke="#f5c0c0" strokeWidth="1.5" />
        <text x="48" y="60" textAnchor="middle" fontSize="8.5" fill="#e3b2b3"
          fontFamily="IBM Plex Sans, sans-serif" fontWeight="600">{label}</text>
        <path d="M30 70 h36" stroke="#3a3138" />
      </svg>
    </div>
  );
}

/** line-art thumbnails for the template cards */
function Thumb({ art }: { art: string }) {
  const s = { stroke: '#f5c0c0', strokeWidth: 1.4, fill: 'none' };
  return (
    <div className="hx-thumb" aria-hidden>
      <svg viewBox="0 0 220 120">
        {art === 'flow' && <>
          <rect x="20" y="30" width="50" height="30" rx="2" {...s} /><rect x="150" y="60" width="50" height="30" rx="2" {...s} />
          <path d="M70 45 C 110 45, 110 75, 150 75" {...s} /><circle cx="70" cy="45" r="3" {...s} /><circle cx="150" cy="75" r="3" {...s} />
        </>}
        {art === 'mimic' && <>
          <path d="M20 90 L70 90 L85 60 L130 60 L145 90 L200 90" {...s} />
          <circle cx="85" cy="60" r="8" {...s} /><circle cx="130" cy="60" r="8" {...s} />
          <path d="M30 40 h40 M30 30 h25" {...s} opacity=".5" />
        </>}
        {art === 'topic' && <>
          {[0, 1, 2, 3].map((i) => <path key={i} d={`M25 ${35 + i * 20} h${[170, 120, 145, 100][i]}`} {...s} opacity={i === 0 ? 1 : .45} />)}
          <circle cx="195" cy="35" r="4" {...s} />
        </>}
        {art === 'alarm' && <>
          <path d="M110 25 L135 70 H85 Z" {...s} /><path d="M110 40 v12 M110 58 v2" {...s} />
          <path d="M30 30 h30 M30 42 h20 M160 80 h30 M165 92 h20" {...s} opacity=".45" />
        </>}
        {art === 'cmd' && <>
          <rect x="30" y="35" width="160" height="50" rx="2" {...s} />
          <path d="M45 55 l10 8 -10 8" {...s} /><path d="M70 70 h40" {...s} opacity=".6" />
          <path d="M150 48 h28 M150 60 h20" {...s} opacity=".4" />
        </>}
        {art === 'insight' && <>
          <path d="M25 95 L60 70 L90 80 L120 45 L150 55 L195 25" {...s} />
          <circle cx="120" cy="45" r="4" {...s} /><path d="M25 95 h170" {...s} opacity=".3" />
        </>}
      </svg>
    </div>
  );
}

/** theme by the Thai clock — paper (light) 06:00–18:00 ICT, ink (dark) at night */
function thaiNight(): boolean {
  const h = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false,
  }).format(new Date()));
  return h < 6 || h >= 18;
}

export function Landing() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const cfg = authConfig();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [menu, setMenu] = useState(false);
  const [dd, setDd] = useState<string | null>(null);
  /** hover intent — pointer can cross the gap to the panel before it closes */
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

  /* scroll reveal — opacity/translate only, IO-driven, one observer */
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('[data-reveal]'));
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('hx-in'));
      return;
    }
    const io = new IntersectionObserver((ents) => {
      ents.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('hx-in'); io.unobserve(e.target); } });
    }, { threshold: 0.15 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  /** validate the token against /api/me BEFORE the real sign-in — staging the
   *  token keeps this component mounted so the error state can render */
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

  const secIcon = (n: IconName) => (
    <span className="hx-secicon"><Icon name={n} size={15} /></span>
  );

  return (
    <div className={`landing-root${dark ? ' hx-dark' : ''}`}>
      <div className="hx-noise" aria-hidden />
      <div className="hx-rail hx-rail-l" aria-hidden />
      <div className="hx-rail hx-rail-r" aria-hidden />

      {/* announcement ticker — mono marquee */}
      <div className="hx-ticker" aria-hidden>
        <div className="hx-ticker-track">
          {[0, 1].map((n) => (
            <span key={n} className="hx-ticker-set">
              {TICKS.map((k) => <span key={k} className="hx-tick">{t(`landing.${k}`)}</span>)}
            </span>
          ))}
        </div>
      </div>

      {/* centered-logo nav — menus left | brand | menus + auth right */}
      <nav className="hx-nav">
        <div className="hx-nav-l">
          <NavDrop menu={NAV_MENUS[0]} open={dd === 'console'}
            onOpen={() => openDd('console')} onClose={closeDd} t={t} />
          <a href="#guard">{t('landing.navControl')}</a>
          <a href="#insight">{t('landing.navInsight')}</a>
        </div>
        <Link to="/" className="hx-logo">
          <span className="hx-logo-mark"><img src="/logo-192.png" alt="" /></span>
          <b>vissointan</b>
        </Link>
        <div className="hx-nav-r">
          <NavDrop menu={NAV_MENUS[1]} open={dd === 'resources'} align="end"
            onOpen={() => openDd('resources')} onClose={closeDd} t={t} />
          <a href="#spec" className="hx-navlink">{t('landing.navSpec')}</a>
          <span className="hx-lang" role="group" aria-label={t('shell.language')}>
            {LANGS.map((l) => (
              <button key={l} type="button" aria-pressed={i18n.language === l} onClick={() => setLang(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </span>
          <Link to="/signin" className="hx-login">{t('shell.signIn')}</Link>
          <HxLink href="#enter" variant="sm" className="hx-nav-cta">{t('landing.ctaEnter')}</HxLink>
          <button className="hx-burger" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <span /><span />
          </button>
        </div>
      </nav>

      {/* mobile full-screen overlay — burger morphs to X-in-circle; grouped
          eyebrow sections, glyph + label + trailing chevron (cf. MobileNav) */}
      {menu && (
        <div className="hx-mnav" role="dialog" aria-modal="true">
          <div className="hx-mnav-head">
            <span className="hx-logo"><span className="hx-logo-mark"><img src="/logo-192.png" alt="" /></span><b>vissointan</b></span>
            <button className="hx-burger is-x" aria-label="Close" onClick={() => setMenu(false)}>
              <Icon name="x" size={16} />
            </button>
          </div>
          <div className="hx-mnav-scroll">
            {NAV_MENUS.map((m) => m.groups.map((g) => (
              <div key={g.eyebrow} className="hx-mnav-group">
                <div className="hx-dd-eyebrow mono">{t(g.eyebrow)}</div>
                {g.items.map((it) => (
                  <a key={it.k} href={it.href} className="hx-mnav-item" onClick={() => setMenu(false)}>
                    <Icon name={it.icon} size={17} />
                    <span>{t(`landing.${it.k}`)}</span>
                    <Icon name="chevron" size={15} className="hx-mnav-go" />
                  </a>
                ))}
              </div>
            )))}
            <div className="hx-mnav-group">
              <a href="#spec" className="hx-mnav-item" onClick={() => setMenu(false)}>
                <Icon name="layers" size={17} /><span>{t('landing.navSpec')}</span>
                <Icon name="chevron" size={15} className="hx-mnav-go" />
              </a>
              <Link to="/signin" className="hx-mnav-item" onClick={() => setMenu(false)}>
                <Icon name="user" size={17} /><span>{t('shell.signIn')}</span>
                <Icon name="chevron" size={15} className="hx-mnav-go" />
              </Link>
            </div>
            <div className="hx-mnav-foot">
              <span className="hx-lang" role="group" aria-label={t('shell.language')}>
                {LANGS.map((l) => (
                  <button key={l} type="button" aria-pressed={i18n.language === l}
                    onClick={() => { setLang(l); setMenu(false); }}>
                    {l.toUpperCase()}
                  </button>
                ))}
              </span>
            </div>
          </div>
        </div>
      )}

      <header className="hx-hero">
        <HeroArt />
        <a href="#spec" className="hx-pill" data-reveal>
          <span className="hx-pill-shine" aria-hidden />
          <Icon name="layers" size={13} />
          {t('landing.badge')}
          <b>{t('landing.badgeLink')} →</b>
        </a>

        <h1 className="hx-h1" data-reveal>
          {t('landing.headlineA')} <em className="hx-serif">{t('landing.headlineB')}</em>
        </h1>
        <p className="hx-sub" data-reveal>{t('landing.sub')}</p>

        <form className="hx-form" id="enter" data-reveal
          onSubmit={(e) => { e.preventDefault(); void enter(); }}>
          <input
            value={token}
            onChange={(e) => { setToken(e.target.value); setFailed(false); }}
            placeholder={cfg?.dev_tokens ? t('auth.demoHint') : t('auth.token')}
            aria-label={t('auth.token')}
            autoComplete="off" spellCheck={false}
          />
          <HxBtn type="submit" variant="lg" disabled={!token.trim() || busy}>
            {busy ? t('auth.signingIn') : `${t('landing.ctaEnter')} →`}
          </HxBtn>
        </form>
        <Link to="/signin" className="hx-sso mono">{t('landing.ctaSso')} →</Link>
        {failed && (
          <div className="notice notice-error mt-3" role="alert" style={{ display: 'inline-flex' }}>
            <Icon name="warn" size={16} /> {t('auth.badToken')}
          </div>
        )}

        {/* trusted-by strip — centered label + static wordmark row
            (cf. Hex's 8-logo row under hero CTAs) */}
        <div className="hx-trusted" data-reveal>
          <p className="mono">{t('landing.trusted')}</p>
          <div className="hx-trusted-row">
            {PROTOCOLS.map((p) => <i key={p}>{p}</i>)}
          </div>
        </div>
      </header>

      {/* §1 live telemetry — bright console panel */}
      <section className="hx-section" data-acc id="caps">
        <div className="hx-split">
          <div className="hx-copy" data-reveal>
            {secIcon('activity')}
            <h2 className="hx-h2">{t('landing.sec1Title')}</h2>
            <p className="hx-body">{t('landing.sec1Body')}</p>
            <HxLink href="#spec" variant="ghost">{t('landing.learnMore')}</HxLink>
          </div>
          <div className="hx-visual" data-reveal aria-hidden><LivePanel /></div>
        </div>
      </section>

      {/* §2 edge → console harmony — bright overlapping cells */}
      <section className="hx-section" data-acc id="flow">
        <div className="hx-split hx-split-rev">
          <div className="hx-copy" data-reveal>
            {secIcon('waves')}
            <h2 className="hx-h2">{t('landing.sec2Title')}</h2>
            <p className="hx-body">{t('landing.sec2Body')}</p>
            <HxLink href="#spec" variant="ghost">{t('landing.learnMore')}</HxLink>
          </div>
          <div className="hx-visual" data-reveal aria-hidden><HarmonyCells /></div>
        </div>
      </section>

      {/* quote band — logo/name left | hairline divider | big quote right */}
      <blockquote className="hx-quote" data-reveal>
        <div className="hx-quote-side">
          <span className="hx-logo-mark"><img src="/logo-192.png" alt="" /></span>
          <b>vissointan</b>
          <span className="mono">{t('landing.quoteSrc')}</span>
        </div>
        <i className="hx-quote-div" aria-hidden />
        <p>{t('landing.quote')}</p>
      </blockquote>

      {/* §3 guarded control — bright alarm card */}
      <section className="hx-section" data-acc id="guard">
        <div className="hx-split">
          <div className="hx-copy" data-reveal>
            {secIcon('alarm')}
            <h2 className="hx-h2">{t('landing.sec3Title')}</h2>
            <p className="hx-body">{t('landing.sec3Body')}</p>
            <HxLink href="#spec" variant="ghost">{t('landing.learnMore')}</HxLink>
          </div>
          <div className="hx-visual" data-reveal aria-hidden><GuardCard /></div>
        </div>
      </section>

      {/* §4 insight DAG — line-art pulse diagram */}
      <section className="hx-section" data-acc id="insight">
        <div className="hx-split hx-split-rev">
          <div className="hx-copy" data-reveal>
            {secIcon('sparkle')}
            <h2 className="hx-h2">{t('landing.sec4Title')}</h2>
            <p className="hx-body">{t('landing.sec4Body')}</p>
            <HxLink href="#spec" variant="ghost">{t('landing.learnMore')}</HxLink>
          </div>
          <div className="hx-visual" data-reveal aria-hidden><DagPanel /></div>
        </div>
      </section>

      {/* big centered band — tiled glyph field behind (cf. Built-for-teams) */}
      <section className="hx-band" data-reveal>
        <GlyphField />
        <h2 className="hx-h1 hx-band-h">{t('landing.builtTitle')}</h2>
        <p className="hx-sub hx-band-sub">{t('landing.builtBody')}</p>
        <HxLink href="#enter" variant="lg">{t('landing.ctaEnter')}</HxLink>
      </section>

      {/* testimonial pair — pennant badges card + quote card */}
      <section className="hx-section hx-testi">
        <div className="hx-testi-grid" data-reveal>
          <div className="hx-testi-card hx-badges">
            <div className="hx-pennant-grid">
              {BADGES.map((b) => <Pennant key={b} label={t(`landing.${b}`)} />)}
            </div>
            <h3>{t('landing.usersLove')}</h3>
            <p>{t('landing.usersLoveSub')}</p>
          </div>
          <div className="hx-testi-card hx-tcard">
            <b className="hx-tcard-logo mono">vissointan</b>
            <p className="hx-tcard-q">{t('landing.testiQuote')}</p>
            <div className="hx-tcard-who">
              <span className="hx-avatar" aria-hidden>{t('landing.testiInitial')}</span>
              <span><b>{t('landing.testiName')}</b><small>{t('landing.testiRole')}</small></span>
            </div>
          </div>
        </div>
      </section>

      {/* template grid — thumbnail cards */}
      <section className="hx-section" data-acc id="templates">
        <div className="hx-copy hx-copy-center" data-reveal>
          <h2 className="hx-h2">{t('landing.capsTitle')}</h2>
        </div>
        <div className="hx-grid">
          {TPLS.map((c) => (
            <div key={c.k} className="hx-card" data-reveal>
              <Thumb art={c.art} />
              <h3>{t(`landing.${c.k}`)}</h3>
              <p>{t(`landing.${c.k}Body`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* spec contract */}
      <section className="hx-section" data-acc id="spec">
        <div className="hx-copy hx-copy-center" data-reveal>
          <h2 className="hx-h2">{t('landing.specTitle')}</h2>
        </div>
        <dl className="hx-spec" data-reveal>
          {SPEC_KEYS.map((k) => (
            <div key={k} className="hx-spec-row">
              <dt>{t(`landing.${k}`)}</dt>
              <dd>{t(`landing.${k}V`)}</dd>
            </div>
          ))}
          <div className="hx-spec-row">
            <dt>{t('landing.specTopic')}</dt>
            <dd><b>{'v2/{org}/{site}/{edge}/…'}</b> — {t('landing.uns')}</dd>
          </div>
        </dl>
      </section>

      {/* column footer */}
      <footer className="hx-foot">
        <div className="hx-foot-grid">
          <div className="hx-foot-brand">
            <span className="hx-logo"><span className="hx-logo-mark"><img src="/logo-192.png" alt="" /></span><b>vissointan</b></span>
            <span className="mono">{t('landing.footMade')} · v0.2</span>
          </div>
          <div className="hx-foot-col">
            <h4 className="mono">{t('landing.footPlatform')}</h4>
            <a href="#caps">{t('landing.footLive')}</a>
            <a href="#caps">{t('landing.footAlarms')}</a>
            <a href="#caps">{t('landing.footCommands')}</a>
          </div>
          <div className="hx-foot-col">
            <h4 className="mono">{t('landing.footResources')}</h4>
            <a href="#spec">{t('landing.footSpec')}</a>
            <a href="#flow">{t('landing.footApi')}</a>
            <a href="#spec">{t('landing.footTopics')}</a>
          </div>
          <div className="hx-foot-col">
            <h4 className="mono">{t('landing.footConnect')}</h4>
            <Link to="/signin">{t('landing.footSignin')}</Link>
            <a href="#enter">{t('landing.ctaEnter')}</a>
            <span>{t('landing.langNote')}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
