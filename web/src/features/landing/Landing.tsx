// Landing — Context Studio clone (hex.tech/product/context-studio).
// Ticker marquee, centered-logo bordered nav, announcement pill, gradient
// display headline + loop video, isometric workflow cards, capability
// diagram, radial feature cards, observability dashboard, quote band,
// 2x2 management grid, two-up testimonials, CTA, FAQ accordion, footer.
// Dual theme preserved: paper by day / ink by night (Thai clock).

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { signIn } from '../../app/session';
import { api, setSessionToken } from '../../lib/api';
import { authConfig } from '../auth/oidc';
import './landing.css';

/* ---------- extracted Hex icons (data-icon set, 15×15) ------------------ */
const I = {
  semanticModels: 'M13 1.00001C13.5523 1.00001 14 1.44773 14 2.00001L14 13C14 13.5523 13.5523 14 13 14L2 14C1.44771 14 0.999999 13.5523 0.999999 13L1 2C1 1.44772 1.44772 1 2 1L13 1.00001ZM2 13L5 13L5 2L2 2L2 13ZM6 13L13 13L13 8.00001L6 8L6 13ZM10.5 10C10.7761 10 11 10.2239 11 10.5C11 10.7761 10.7761 11 10.5 11L7.5 11C7.22386 11 7 10.7761 7 10.5C7 10.2239 7.22386 10 7.5 10L10.5 10ZM6 7L13 7.00001L13 2.00001L6 2L6 7ZM10.5 4.00001C10.7761 4.00001 11 4.22387 11 4.50001C11 4.77615 10.7761 5.00001 10.5 5.00001L7.5 5.00001C7.22386 5 7 4.77614 7 4.5C7 4.22386 7.22386 4.00001 7.5 4.00001L10.5 4.00001Z',
  notebook:
    'M13 7H2V12.5C2 12.7761 2.22386 13 2.5 13H12.5C12.7761 13 13 12.7761 13 12.5V7ZM13 2.5C13 2.22386 12.7761 2 12.5 2H2.5C2.22386 2 2 2.22386 2 2.5V6H13V2.5ZM14 12.5C14 13.3284 13.3284 14 12.5 14H2.5C1.67157 14 1 13.3284 1 12.5V2.5C1 1.67157 1.67157 1 2.5 1H12.5C13.3284 1 14 1.67157 14 2.5V12.5Z',
  notebookFill: 'M2 13C2 13.5523 2.44772 14 3 14H12C12.5523 14 13 13.5523 13 13V6.5H8H2V13Z',
  threads:
    'M12 1C13.6569 1 15 2.34315 15 4V7C15 8.60511 13.7394 9.91579 12.1543 9.99609L12 10H11V11C11 12.6051 9.73945 13.9158 8.1543 13.9961L8 14H3L2.8457 13.9961C1.26055 13.9158 0 12.6051 0 11V8C0 6.34315 1.34315 5 3 5H4V4C4 2.34315 5.34315 1 7 1H12ZM3 6C1.89543 6 1 6.89543 1 8V11C1 12.1046 1.89543 13 3 13H8C9.10457 13 10 12.1046 10 11V10H7L6.8457 9.99609C5.26055 9.91579 4 8.60511 4 7V6H3ZM5 7C5 8.10457 5.89543 9 7 9H10V8C10 6.89543 9.10457 6 8 6H5V7ZM7 2C5.89543 2 5 2.89543 5 4V5H8C9.65685 5 11 6.34315 11 8V9H12C13.1046 9 14 8.10457 14 7V4C14 2.89543 13.1046 2 12 2H7Z',
  apps:
    'M8 8H2V12.3846C2 12.682 2.318 13 2.61538 13H8V8ZM13 2.5C13 2.20262 12.682 2 12.3846 2H2.61538C2.318 2 2 2.318 2 2.61538V7H13V2.5ZM9 13H12.3846C12.682 13 13 12.682 13 12.3846V8H9V13ZM14 12.3846C14 13.2768 13.2768 14 12.3846 14H2.61538C1.72323 14 1 13.2768 1 12.3846V2.61538C1 1.72323 1.72323 1 2.61538 1H12.3846C13.2768 1 14 1.72323 14 2.61538V12.3846Z',
  appsFill: 'M8.0006 8.00011V11.2309V13H12.5C12.8395 13 13.1148 12.736 13.1148 12.4103V8.00011H8.0006Z',
  cli: 'M14 13H5V12H14V13ZM6.53027 6.64648L2.17676 11L1.46973 10.293L5.11621 6.64648L1.46973 3L2.17676 2.29297L6.53027 6.64648Z',
  chevron: 'M4.50001 5.79289L7.50001 8.79289L10.5 5.79289L11.2071 6.5L7.50001 10.2071L3.79291 6.5L4.50001 5.79289Z',
  arrowR:
    'M6.14645 5.14645L5.79289 5.5L6.5 6.20711L6.85355 5.85355L6.14645 5.14645ZM8.5 3.5L8.85355 3.85355L9.20711 3.5L8.85355 3.14645L8.5 3.5ZM6.85355 1.14645L6.5 0.792893L5.79289 1.5L6.14645 1.85355L6.85355 1.14645ZM6.85355 5.85355L8.85355 3.85355L8.14645 3.14645L6.14645 5.14645L6.85355 5.85355ZM8.85355 3.14645L6.85355 1.14645L6.14645 1.85355L8.14645 3.85355L8.85355 3.14645ZM8.5 3H0V4H8.5V3Z',
};

function HxIcon({ d, size = 15, className = '' }: { d: string; size?: number; className?: string }) {
  return (
    <svg className={className} height={size} viewBox="0 0 15 15" width={size} aria-hidden>
      <path clipRule="evenodd" d={d} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/* ---------- copy --------------------------------------------------------- */
const TICKER = [
  { e: '📊', b: 'AI analytics use case:', t: 'how LangChain migrated from legacy BI and enabled 100% of their team to self-serve data' },
  { e: '🤯', b: 'Generative data apps:', t: 'Gorgeous, interactive dashboards and apps you can build with just a prompt' },
  { e: '📖', b: 'State of Data Teams 2026', t: 'discover key findings from our survey of 800+ data leaders' },
  { e: '🙏', b: "It's just \"Hex\"!", t: 'Not "HEX" or "Hex dot tech" — a note from our team' },
];

const NAV_DROPS: { id: string; label: string; items: { t: string; d: string }[] }[] = [
  {
    id: 'platform', label: 'Platform',
    items: [
      { t: 'Agentic notebooks', d: 'Powerful, deep-dive analysis with AI by your side' },
      { t: 'Conversational analytics', d: 'Ask and explore with governed self-serve' },
      { t: 'Context Studio', d: 'Build trusted context for every answer' },
      { t: 'Data apps', d: 'Build and share interactive data apps' },
      { t: 'Hex CLI', d: 'Control your analytics from the terminal' },
      { t: 'Integrations', d: 'Out-of-the-box connections across your stack' },
    ],
  },
  {
    id: 'solutions', label: 'Solutions',
    items: [
      { t: 'Data leader', d: 'Focus your team on the work that matters' },
      { t: 'Product', d: 'Build your product on trusted data' },
      { t: 'Marketing', d: 'Turn scattered spend into clear signal' },
      { t: 'Sales', d: 'Clear pipeline. Confident forecasts' },
      { t: 'Customer success', d: 'Proactive answers for every account' },
    ],
  },
  {
    id: 'resources', label: 'Resources',
    items: [
      { t: 'Docs', d: 'Resources and product guides' },
      { t: 'Changelog', d: 'Product updates' },
      { t: 'Blog', d: 'From data teams to data teams' },
      { t: 'Guides', d: 'Learn how to do more with data, together' },
      { t: 'Events', d: 'Learn and connect with peers' },
      { t: 'Customer stories', d: 'Empowering the best data teams' },
    ],
  },
];

const WORKFLOWS = [
  {
    id: 'unified-context', title: 'Unified context',
    body: 'Activate logic from dbt, Git repos, and docs, then build on it in Hex or throughout your stack.',
    img: '/cs/iso-unified.svg', tint: 'jade',
  },
  {
    id: 'observable-everywhere', title: 'Observable everywhere',
    body: 'Track and audit any answer no matter where questions are asked: Hex, Slack, MCP, CLI.',
    img: '/cs/iso-observe.svg', tint: 'citrine',
  },
  {
    id: 'improves-with-use', title: 'Improves with use',
    body: 'Hex learns from every interaction, sharpening context and improving accuracy on the fly.',
    img: '/cs/iso-audit.svg', tint: 'amethyst',
  },
];

const CAPS = [
  { icon: 'notebook', label: 'Notebook', pop: 'AI-powered assistance directly into your Hex projects. Write and edit code, ask questions, and get answers all in one place.' },
  { icon: 'threads', label: 'Threads', pop: 'Ask natural language questions and get AI-powered insights based on semantic models and warehouse tables' },
  { icon: 'semanticModels', label: 'Workbench', pop: 'Write and edit semantic resources using natural language. Describe the model you want and let the agent generate or update it.' },
  { icon: 'apps', label: 'Apps', pop: 'Build and share interactive data apps powered by governed context' },
  { icon: 'cli', label: 'CLI', pop: 'Manage context, review suggestions, and run evals from the terminal' },
] as const;

const UC_CARDS = [
  {
    h: 'Activate existing logic',
    p: 'Markdown, code, table metadata. Hex ingests and understands it for trusted answers without exhaustive modeling.',
    link: 'Explore context management', img: '/cs/illustration-guides.png',
  },
  {
    h: 'Build from anywhere',
    p: 'Layer in new logic in Hex, dbt, or your warehouse. Hex keeps it synced and versioned, without locking you into one tool.',
    link: 'Explore semantic models', img: '/cs/illustration-workbench.png',
  },
];

const IWU_CARDS = [
  {
    h: 'Fixes find you',
    p: 'The Review Agent analyzes interactions for you to find context gaps and suggest fixes.',
    img: '/cs/illustration-ui-suggestions.png',
  },
  {
    h: 'Every change, evaluated',
    p: 'Improve context with evidence, not instinct. Test changes with evals, ship what passes and catch what breaks.',
    img: '/cs/illustration-ui-eval-detail.png',
  },
  {
    h: 'Your work is context',
    p: 'The logic and queries behind every published app are reusable context for future questions.',
    img: '/cs/illustration-ui-work-is-context.png',
  },
];

const MGR_CARDS = [
  {
    h: 'Pull knowledge from your tools',
    p: 'Connect Notion, Linear, or any MCP server to bring tickets, wikis, and more into Hex, so answers capture what your team knows.',
    img: '/cs/illustration-pull-knowledge.png',
  },
  {
    h: 'Manage context from the terminal',
    p: 'Use the Hex CLI to version context from Git, pull agent suggestions into PRs, and run evals before shipping changes.',
    img: '/cs/illustration-hex-cli-suggestions.png',
  },
  {
    h: 'Bring your semantic models',
    p: 'Sync semantic models from dbt MetricFlow, Cube, or Snowflake. Definitions stay versioned in your stack while Hex stays in sync.',
    img: '/cs/illustration-open-standards.png',
  },
  {
    h: 'Model only what you need',
    p: 'Go off-road in the Hex notebook for flexible exploration, without turning every one-off idea into permanent logic.',
    img: '/cs/illustration-notebook.png',
  },
];

const FAQS = [
  {
    q: 'What can I actually use as context? Can I connect existing sources?',
    a: "Almost anything you already have, and you don't have to set it all up first. Context in Hex layers in over time instead of arriving as one big modeling project. Start with what exists, add more as you go:",
    li: [
      'Table metadata: column names, types, and descriptions the agent reads to understand your schema without you modeling every dimension first.',
      'Endorsed tables: mark certain tables as the canonical, trusted source, and the agent prefers them when several tables could answer a question.',
      'Reference repositories: connect a Git repo so the agent can read your code to clarify things like metric logic and table structures.',
      "Connected apps via MCP: pull context from Notion, Linear, and any MCP server, so answers reflect what's in your tickets, docs, and planning notes, not just your data.",
      'Guides: markdown files about your data and business. A workspace context file is read in every conversation, while a guide library holds topic-specific files the agent pulls in only when relevant.',
      'Semantic models: governed metric and dimension definitions, synced from dbt MetricFlow, Cube, or Snowflake — or built directly in Hex.',
      'Published work: apps, notebooks, and dashboards your team has already built feed the agent real, proven logic.',
    ],
  },
  {
    q: 'Do I have to build my context in Hex? Or can it be synced in?',
    a: 'No, you can build and manage context inside or outside of Hex. Where you centralize your source of truth is up to you. Context is intentionally set up to let you move it between Hex and wherever else you manage it:',
    li: [
      'Guides can live as .md files in a repo and sync to Hex automatically with a GitHub Action, so the repo stays the source of truth.',
      'Sync in semantic models from dbt MetricFlow, Cube, or Snowflake Semantic Views, and the definitions stay versioned in your stack.',
      "You can author guides and semantic models directly in Hex too. Either way, your context stays portable, so you're never locked in and never rebuilding logic if your stack changes.",
    ],
  },
  {
    q: 'How does Hex decide which context to use? Can I see what Hex used as context?',
    a: "The Hex agent is built to pull the right context when it's relevant, whether that's markdown, code, yaml, metadata, or anything else. It uses indicators like the descriptions of guides and repos to judge relevance.",
    li2: "For every interaction, you can audit the agent's reasoning and the context it used from Context Studio. If the agent is unsure or missing something, it raises a warning. Admins and Managers can review individual conversations, common topics, warnings, and see which context sources shaped a response.",
  },
  {
    q: 'Do I need to build semantic models for accurate and consistent answers?',
    a: 'Not necessarily. Semantic models are one way to give the agent context around specific metrics or definitions, but they are inherently rigid and time intensive to maintain. In Hex, build them where a shared, locked definition matters, and skip them where a guide or an endorsed table is sufficient guidance for the agent to answer a question.',
    li: [
      "Where models earn their keep: a metric like ARR that has to be calculated the same way every time, everywhere it's asked.",
      "Where they don't: nuances about your business, like when your fiscal year starts or what a specific product term means inside your company. No need to build that into a model when it can be captured quickly in a markdown doc.",
      'If you do choose to build semantic models, you can sync them from dbt MetricFlow, Cube, or Snowflake, or build them directly in Hex.',
    ],
  },
  {
    q: 'How much work is it to maintain context as our business changes?',
    a: "Context drifts as your business evolves, definitions change, and new domains emerge. Hex's Context Engine is intentionally built to catch and fix these gaps for you instead of manually sifting through every conversation to maintain yourself.",
    li: [
      'The Review Agent watches real interactions and flags where context is missing or thin, so you\u2019re not auditing every answer yourself.',
      'Repeated warnings roll into concrete suggestions, so high-impact improvements come to you already scoped.',
      'Your published work compounds: every app and dashboard published feeds the agent, so a lot of context accrues as a byproduct of normal work, not as separate upkeep.',
    ],
    li2: 'The system gets sharper the more your team uses it. Every question asked and answer published makes the next answer better, so accuracy compounds over time instead of decaying. You stay in control of what changes; the agent just makes sure the work keeps building.',
  },
];

const FOOT_COLS = [
  { h: 'Platform', links: ['AI and agents', 'Agentic notebooks', 'Conversational analytics', 'Context Studio', 'Data apps', 'Hex CLI', 'Business intelligence', 'Exploratory analysis', 'Embedded analytics', 'Integrations', 'Changelog'] },
  { h: 'Resources', links: ['Pricing', 'Switching to Hex', 'Enterprise', 'Docs', 'Blog', 'Events', 'Templates', 'Compare', 'Trust Center', 'Status'] },
  { h: 'Company', links: ['About', 'Careers', 'Customers', 'Solutions', 'Media kit', 'Newsroom'] },
  { h: 'Connect', links: ['Request a demo', 'Technical support', 'Contact us', 'LinkedIn', 'X (Twitter)', 'YouTube'] },
];

/* ---------- primitives ---------------------------------------------------- */
/** signature Hex button — gradient hairline border + corner ticks */
function HxBtn({ children, variant, className = '', ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'lg' | 'ghost' }) {
  return (
    <button {...rest} className={`cs-btn ${variant ? `cs-btn-${variant}` : ''} ${className}`}>
      <span className="cs-corners" aria-hidden><i /><i /><i /><i /></span>
      <span className="cs-btn-label">{children}</span>
    </button>
  );
}
function HxLink({ children, variant, className = '', ...rest }:
  React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: 'lg' | 'ghost' | 'sm' }) {
  return (
    <a {...rest} className={`cs-btn ${variant ? `cs-btn-${variant}` : ''} ${className}`}>
      <span className="cs-corners" aria-hidden><i /><i /><i /><i /></span>
      <span className="cs-btn-label">{children}</span>
    </a>
  );
}

/** nav mega-menu dropdown */
function NavDrop({ menu, open, onOpen, onClose }: {
  menu: (typeof NAV_DROPS)[number]; open: boolean; onOpen: () => void; onClose: () => void;
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
            <a key={it.t} href="#" className="cs-dd-item" role="menuitem" onClick={(e) => { e.preventDefault(); onClose(); }}>
              <span><b>{it.t}</b><small>{it.d}</small></span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
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
  const cfg = authConfig();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [menu, setMenu] = useState(false);
  const [dd, setDd] = useState<string | null>(null);
  const [faq, setFaq] = useState<number | null>(null);
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
  }, []);

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

  return (
    <div className={`landing-root${dark ? ' hx-dark' : ''}`}>
      <div className="cs-noise" aria-hidden />
      <div className="cs-rail cs-rail-l" aria-hidden />
      <div className="cs-rail cs-rail-r" aria-hidden />

      {/* ---------- announcement ticker ---------- */}
      <div className="cs-ticker cs-marks" role="group" aria-label="Announcements">
        <i className="m-bl" aria-hidden /><i className="m-br" aria-hidden />
        <div className="cs-ticker-track">
          {[0, 1].map((n) => (
            <div key={n} className="cs-ticker-set" aria-hidden={n === 1}>
              {TICKER.map((it) => (
                <a key={it.b} href="#" className="cs-tick" onClick={(e) => e.preventDefault()}>
                  <span>{it.e}</span>&nbsp;<b>{it.b}</b>&nbsp;{it.t}
                  <i className="cs-tick-arrow"><HxIcon d={I.arrowR} size={9} /></i>
                </a>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ---------- nav — bordered bar, centered logo ---------- */}
      <nav className="cs-nav">
        <div className="cs-nav-l">
          <NavDrop menu={NAV_DROPS[0]} open={dd === 'platform'} onOpen={() => openDd('platform')} onClose={closeDd} />
          <NavDrop menu={NAV_DROPS[1]} open={dd === 'solutions'} onOpen={() => openDd('solutions')} onClose={closeDd} />
          <a href="#" onClick={(e) => e.preventDefault()} className="cs-navlink">Enterprise</a>
        </div>
        <Link to="/" className="cs-logo">HEX</Link>
        <div className="cs-nav-r">
          <NavDrop menu={NAV_DROPS[2]} open={dd === 'resources'} onOpen={() => openDd('resources')} onClose={closeDd} />
          <a href="#" onClick={(e) => e.preventDefault()} className="cs-navlink">Pricing</a>
          <Link to="/signin" className="cs-login">Log In</Link>
          <HxLink href="#enter" variant="sm" className="cs-nav-cta">Get started</HxLink>
          <button className="cs-burger" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <span /><span />
          </button>
        </div>
      </nav>

      {/* mobile overlay nav */}
      {menu && (
        <div className="cs-mnav" role="dialog" aria-modal="true">
          <div className="cs-mnav-head">
            <span className="cs-logo">HEX</span>
            <button className="cs-burger is-x" aria-label="Close" onClick={() => setMenu(false)}>✕</button>
          </div>
          <div className="cs-mnav-scroll">
            {NAV_DROPS.map((m) => (
              <div key={m.id} className="cs-mnav-group">
                <div className="cs-dd-eyebrow">{m.label}</div>
                {m.items.map((it) => (
                  <a key={it.t} href="#" className="cs-mnav-item" onClick={(e) => { e.preventDefault(); setMenu(false); }}>
                    <span>{it.t}</span>
                  </a>
                ))}
              </div>
            ))}
            <div className="cs-mnav-group">
              <Link to="/signin" className="cs-mnav-item" onClick={() => setMenu(false)}><span>Log In</span></Link>
              <a href="#enter" className="cs-mnav-item" onClick={() => setMenu(false)}><span>Get started</span></a>
            </div>
          </div>
        </div>
      )}

      {/* ---------- hero ---------- */}
      <header className="cs-hero">
        <div className="cs-hero-dots" aria-hidden />
        <div className="cs-hero-grid">
          <div className="cs-hero-copy">
            <a href="#" className="cs-pill" onClick={(e) => e.preventDefault()} data-reveal>
              <span className="cs-pill-inner">
                <i className="cs-pill-icon"><HxIcon d={I.semanticModels} size={15} /></i>
                Context Studio
              </span>
              <span className="cs-pill-link">Read the announcement<HxIcon d={I.arrowR} size={10} /></span>
            </a>
            <h1 className="cs-h1" data-reveal>
              Accuracy that improves<br />
              <em>with every answer</em>
            </h1>
            <p className="cs-hero-sub" data-reveal>
              Skip the months-long modeling project. Hex’s{' '}
              <span className="cs-chip"><i className="cs-chip-i"><HxIcon d={I.semanticModels} size={11} /></i>Context Studio</span>{' '}
              activates the logic you already have and learns from every{' '}
              <span className="cs-chip"><i className="cs-chip-i"><HxIcon d={I.threads} size={11} /></i>answer</span>.
            </p>
            <div className="cs-hero-cta" data-reveal>
              <HxLink href="#enter" variant="lg">Request a demo</HxLink>
              <HxLink href="#purpose" variant="ghost" className="cs-btn-lg">Learn more</HxLink>
            </div>
          </div>
          <div className="cs-hero-media" data-reveal>
            <div className="cs-video-wrap">
              <video className="cs-video" autoPlay muted loop playsInline
                preload="auto" poster="/cs/hero-poster.jpg"
                src="/cs/hero-video.mp4" />
              <span className="cs-play" aria-hidden>
                <svg height="17" viewBox="0 0 15 17" width="15">
                  <path d="M12.7007 7.50366C13.5359 7.9859 13.5887 9.14654 12.8579 9.71362L12.7007 9.81909L2.84131 15.5115C1.95038 16.0254 0.837402 15.3819 0.837402 14.3533L0.837402 2.96948C0.837402 2.00499 1.81587 1.37891 2.67236 1.72827L2.84131 1.81128L12.7007 7.50366Z" fill="currentColor" />
                </svg>
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* ---------- trusted-by strip — bracketed label, logo grid ---------- */}
      <section className="cs-trust cs-marks" data-reveal>
        <i className="m-tl" aria-hidden /><i className="m-tr" aria-hidden />
        <i className="m-bl" aria-hidden /><i className="m-br" aria-hidden />
        <p className="cs-trust-label mono">
          <i className="cs-cap cs-cap-l" aria-hidden />
          Trusted by leading data companies
          <i className="cs-cap cs-cap-r" aria-hidden />
        </p>
        <div className="cs-trust-row">
          <img src="/cs/logo-notion.svg" alt="Notion" />
          <img src="/cs/logo-wb.svg" alt="Weights &amp; Biases" />
          <img src="/cs/zoe-logo.svg" alt="Zoe" />
          <span className="cs-trust-wm">LangChain</span>
          <span className="cs-trust-wm">Ramp</span>
          <span className="cs-trust-wm">dbt Labs</span>
        </div>
      </section>

      {/* ---------- purpose-built / workflow cards ---------- */}
      <section className="cs-sec" id="purpose">
        <h2 className="cs-h2" data-reveal>The fastest way to sharpen agents on your data</h2>
        <div className="cs-wf">
          <div className="cs-wf-hrule" aria-hidden><i /><i className="cs-plus" /><i /></div>
          <div className="cs-wf-grid">
            {WORKFLOWS.map((w) => (
              <a key={w.id} href={`#${w.id}`} className={`cs-wf-card cs-tint-${w.tint}`} data-reveal>
                <div className="cs-wf-art">
                  <div className="cs-wf-noise" aria-hidden />
                  <img src={w.img} alt="" loading="lazy" />
                </div>
                <div className="cs-wf-cap">
                  <h3>{w.title}</h3>
                  <p>{w.body}</p>
                </div>
              </a>
            ))}
          </div>
          {/* capability diagram — dashed box, mono chip, icon row */}
          <div className="cs-caps" data-reveal>
            <div className="cs-caps-chip mono">Improve agent accuracy</div>
            <div className="cs-caps-line" aria-hidden />
            <div className="cs-caps-row">
              {CAPS.map((cp) => (
                <div key={cp.label} className="cs-cap">
                  <div className="cs-cap-pop">{cp.pop}</div>
                  <HxIcon d={I[cp.icon as keyof typeof I]} size={15} />
                  <span className="mono">{cp.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------- unified context ---------- */}
      <section className="cs-sec" id="unified-context">
        <h2 className="cs-h2" data-reveal>Unified context</h2>
        <p className="cs-sub2" data-reveal>
          Hex turns definitions and logic into trusted business context for agents
          to reason from, wherever they’re working.
        </p>
        <div className="cs-duo">
          {UC_CARDS.map((c) => (
            <div key={c.h} className="cs-bigcard" data-reveal>
              <div className="cs-bigcard-txt">
                <h3>{c.h}</h3>
                <p>{c.p}</p>
                <a href="#" onClick={(e) => e.preventDefault()} className="cs-linkbox">{c.link}</a>
              </div>
              <img src={c.img} alt="" loading="lazy" />
            </div>
          ))}
        </div>
      </section>

      {/* ---------- observable everywhere ---------- */}
      <section className="cs-sec" id="observable-everywhere">
        <h2 className="cs-h2" data-reveal>Observable everywhere</h2>
        <p className="cs-sub2" data-reveal>
          Questions get asked everywhere: Slack, Claude, Cursor. Hex gives you
          visibility into every answer, and a way to keep improving it.
        </p>
        <div className="cs-obs" data-reveal>
          <div className="cs-obs-call cs-obs-l">
            <i aria-hidden />
            <h4>Trends surfaced automatically</h4>
            <p>Track agent adoption across all of Hex surfaces. See question domains that are growing, trending, or newly emerging with Topics.</p>
          </div>
          <div className="cs-obs-dash">
            <img src="/cs/obs-dashboard.png" alt="Agent observability dashboard" loading="lazy" />
          </div>
          <div className="cs-obs-call cs-obs-r">
            <i aria-hidden />
            <h4>The agent suggests improvements</h4>
            <p>Warnings surface agent confusion, missing context, or user doubt. The Review Agent tells you exactly what to fix.</p>
          </div>
        </div>
      </section>

      {/* ---------- improves with use ---------- */}
      <section className="cs-sec" id="improves-with-use">
        <h2 className="cs-h2" data-reveal>Improves with use</h2>
        <p className="cs-sub2" data-reveal>
          Hex learns from every question asked and every answer published, so
          you’re always ahead of drift — without the maintenance treadmill.
        </p>
        <div className="cs-trio">
          {IWU_CARDS.map((c) => (
            <div key={c.h} className="cs-iwucard" data-reveal>
              <div className="cs-iwu-art"><img src={c.img} alt="" loading="lazy" /></div>
              <h3>{c.h}</h3>
              <p>{c.p}</p>
              <a href="#" onClick={(e) => e.preventDefault()} className="cs-linkbox">Learn more</a>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- full-width quote ---------- */}
      <blockquote className="cs-quote" data-reveal>
        <div className="cs-quote-side">
          <img src="/cs/zoe-logo.svg" alt="Zoe" className="cs-quote-logo" />
          <b>Craig W.</b>
          <span className="mono">Staff Data Engineer, Zoe</span>
        </div>
        <p className="cs-quote-text">
          “Context Studio gives us the confidence to roll out agents on our data.
          It’s something I check every day — <b>seeing context gaps and suggested
          improvements surfaced automatically</b> provides a practical way for us
          to bring trusted AI self-service to the business.”
        </p>
      </blockquote>

      {/* ---------- build and manage ---------- */}
      <section className="cs-sec" id="manage">
        <h2 className="cs-h2" data-reveal>Build and manage context on your terms</h2>
        <p className="cs-sub2" data-reveal>
          Context curation in Hex is intentionally flexible, so it can adapt to
          the way your team already works — not the other way around.
        </p>
        <div className="cs-quad">
          {MGR_CARDS.map((c) => (
            <div key={c.h} className="cs-mgrcard" data-reveal>
              <div className="cs-mgr-txt">
                <h3>{c.h}</h3>
                <p>{c.p}</p>
              </div>
              <div className="cs-mgr-art"><img src={c.img} alt="" loading="lazy" /></div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- two-up testimonials ---------- */}
      <section className="cs-testi" data-reveal>
        <div className="cs-testi-cell">
          <img src="/cs/logo-notion.svg" alt="" className="cs-testi-logo" />
          <p>“Development and deployment is so speedy. <b>Seeing my semantic model changes immediately rendered in Hex was a joy.</b>”</p>
          <div><b>Peter R.</b><span className="mono">Data Engineer at Notion</span></div>
        </div>
        <div className="cs-testi-cell">
          <img src="/cs/logo-wb.svg" alt="Weights & Biases" className="cs-testi-logo" />
          <p>“Hex made setting up a connection to MetricFlow a breeze! <b>The intuitive click-and-drag UI empowers our stakeholders to perform self-serve analysis.</b>”</p>
          <div><b>Mercedes W.</b><span className="mono">Data Scientist at Weights &amp; Biases</span></div>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="cs-cta" id="enter">
        <div className="cs-cta-box" data-reveal>
          <h2 className="cs-h2">Bring speed &amp; trust together in Hex</h2>
          <p className="cs-sub2">Get in touch with us to see a demo or find out which plan is right for you.</p>
          <HxLink href="#enter" variant="lg">Contact Sales</HxLink>
          {/* working sign-in — the landing doubles as the token wall */}
          <form className="cs-token"
            onSubmit={(e) => { e.preventDefault(); void enter(); }}>
            <input
              value={token}
              onChange={(e) => { setToken(e.target.value); setFailed(false); }}
              placeholder={cfg?.dev_tokens ? 'demo-operator · demo-viewer' : 'Access token'}
              aria-label="Access token" autoComplete="off" spellCheck={false}
            />
            <HxBtn type="submit" disabled={!token.trim() || busy}>
              {busy ? 'Signing in…' : 'Enter'}
            </HxBtn>
          </form>
          {failed && <p className="cs-token-err" role="alert">That token didn’t work — check it and try again.</p>}
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="cs-sec cs-faq" id="faq">
        <h2 className="cs-h2" data-reveal>FAQ</h2>
        <div className="cs-faq-list" data-reveal>
          {FAQS.map((f, i) => (
            <div key={f.q} className={`cs-faq-item${faq === i ? ' is-open' : ''}`}>
              <h3>
                <button type="button" aria-expanded={faq === i}
                  onClick={() => setFaq(faq === i ? null : i)}>
                  <span>{f.q}</span>
                  <HxIcon d={I.chevron} size={15} className="cs-faq-chev" />
                </button>
              </h3>
              {faq === i && (
                <div className="cs-faq-a">
                  <p>{f.a}</p>
                  {f.li && <ul>{f.li.map((l) => <li key={l}>{l}</li>)}</ul>}
                  {f.li2 && <p>{f.li2}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="cs-faq-more">Can’t find your answer here? <a href="#enter">Get in touch.</a></p>
      </section>

      {/* ---------- footer ---------- */}
      <footer className="cs-foot">
        <div className="cs-foot-inner">
          <div className="cs-foot-brand">
            <span className="cs-logo">HEX</span>
            <span className="cs-foot-made mono">Made with 💜 on 🌎</span>
          </div>
          {FOOT_COLS.map((c) => (
            <div key={c.h} className="cs-foot-col">
              <h4 className="mono">{c.h}</h4>
              {c.links.map((l) => <a key={l} href="#" onClick={(e) => e.preventDefault()}>{l}</a>)}
            </div>
          ))}
        </div>
        <div className="cs-foot-bottom">
          <span>© 2026 Hex Technologies Inc.</span>
          <div>
            <a href="#" onClick={(e) => e.preventDefault()}>Privacy policy</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Terms &amp; conditions</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Modern slavery statement</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Opt out of tracking</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
