// Landing — vissointan marketing page on the hex.tech homepage layout
// (fall-2026 design). Maroon ticker, bordered nav with mega-menus, centered
// hero with serif-italic line + pill chips, open-stack wall with hover cards,
// alternating feature rows with real console screenshots, ethos pair,
// testimonials, use cases, built-for grid, integrations, CTA, FAQ, footer.
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
  threads:
    'M12 1C13.6569 1 15 2.34315 15 4V7C15 8.60511 13.7394 9.91579 12.1543 9.99609L12 10H11V11C11 12.6051 9.73945 13.9158 8.1543 13.9961L8 14H3L2.8457 13.9961C1.26055 13.9158 0 12.6051 0 11V8C0 6.34315 1.34315 5 3 5H4V4C4 2.34315 5.34315 1 7 1H12ZM3 6C1.89543 6 1 6.89543 1 8V11C1 12.1046 1.89543 13 3 13H8C9.10457 13 10 12.1046 10 11V10H7L6.8457 9.99609C5.26055 9.91579 4 8.60511 4 7V6H3ZM5 7C5 8.10457 5.89543 9 7 9H10V8C10 6.89543 9.10457 6 8 6H5V7ZM7 2C5.89543 2 5 2.89543 5 4V5H8C9.65685 5 11 6.34315 11 8V9H12C13.1046 9 14 8.10457 14 7V4C14 2.89543 13.1046 2 12 2H7Z',
  apps:
    'M8 8H2V12.3846C2 12.682 2.318 13 2.61538 13H8V8ZM13 2.5C13 2.20262 12.682 2 12.3846 2H2.61538C2.318 2 2 2.318 2 2.61538V7H13V8ZM9 13H12.3846C12.682 13 13 12.682 13 12.3846V8H9V13ZM14 12.3846C14 13.2768 13.2768 14 12.3846 14H2.61538C1.72323 14 1 13.2768 1 12.3846V2.61538C1 1.72323 1.72323 1 2.61538 1H12.3846C13.2768 1 14 1.72323 14 2.61538V12.3846Z',
  cli: 'M14 13H5V12H14V13ZM6.53027 6.64648L2.17676 11L1.46973 10.293L5.11621 6.64648L1.46973 3L2.17676 2.29297L6.53027 6.64648Z',
  chevron: 'M4.50001 5.79289L7.50001 8.79289L10.5 5.79289L11.2071 6.5L7.50001 10.2071L3.79291 6.5L4.50001 5.79289Z',
  arrowR:
    'M6.14645 5.14645L5.79289 5.5L6.5 6.20711L6.85355 5.85355L6.14645 5.14645ZM8.5 3.5L8.85355 3.85355L9.20711 3.5L8.85355 3.14645L8.5 3.5ZM6.85355 1.14645L6.5 0.792893L5.79289 1.5L6.14645 1.85355L6.85355 1.14645ZM6.85355 5.85355L8.85355 3.85355L8.14645 3.14645L6.14645 5.14645L6.85355 5.85355ZM8.85355 3.14645L6.85355 1.14645L6.14645 1.85355L8.14645 3.85355L8.85355 3.14645ZM8.5 3H0V4H8.5V3Z',
  arrowTR:
    'M11.4986 3.49866L11.9992 3.49866L11.9985 2.99873L11.4986 2.99803L11.4986 3.49866ZM10.9979 3.49866L10.9972 9L11.9985 9L11.9992 3.49866L10.9979 3.49866ZM11.4986 2.99803L5.99941 2.99888V4.00014L11.4986 3.99929L11.4986 2.99803ZM11.145 3.14511L2.30618 11.9839L3.01328 12.691L11.8521 3.85221L11.145 3.14511Z',
};

function HxIcon({ d, size = 15, className = '' }: { d: string; size?: number; className?: string }) {
  return (
    <svg className={className} height={size} viewBox="0 0 15 15" width={size} aria-hidden>
      <path clipRule="evenodd" d={d} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/* red pixel-star sparkle that sits beside the hero h1 */
function Sparkle() {
  return (
    <svg className="hx-sparkle" width="51" height="52" viewBox="0 0 51 52" fill="none" aria-hidden>
      <path fill="currentColor" d="M51 52h-4v-4h4zm-4-4h-4v-4h4zm-4-4h-4v-4h4zm-4-4h-4v-4h4zm12-16v4H35v-4zm-35-8h-4v-4h4zm12 0h-4V0h4zm11 0h-4v-4h4zm-27-4H8V8h4zm31 0h-4V8h4zM8 8H4V4h4zm39 0h-4V4h4zM4 4H0V0h4zm47 0h-4V0h4z" />
    </svg>
  );
}

/* ---------- copy --------------------------------------------------------- */
const TICKER = [
  { e: '🏭', b: 'v6 console:', t: 'a Datadog-grade ops surface for the sorting line — overview, twin, alarms, SLOs' },
  { e: '�', b: 'Assistant AI:', t: 'insights propose, operators approve — plug in a model with INFERENCE_URL' },
  { e: '�', b: 'Modbus adapter:', t: 'point edge1 at a real PLC or Factory I/O — the simulator ships in the box' },
  { e: '�', b: 'Zero-trust edge:', t: 'MQTT over TLS with per-identity dynsec ACLs' },
];

const NAV_DROPS: { id: string; label: string; items: { t: string; d: string }[] }[] = [
  {
    id: 'platform', label: 'Platform',
    items: [
      { t: 'Agentic notebooks', d: 'Powerful, deep-dive analysis without the silos' },
      { t: 'Conversational analytics', d: 'Ask and explore data in plain language' },
      { t: 'Context Studio', d: 'Build trust in data with semantic models and AI governance' },
      { t: 'Data apps', d: 'Build and share interactive dashboards and reporting' },
      { t: 'Hex CLI', d: 'Control your analytics from the terminal' },
    ],
  },
  {
    id: 'solutions', label: 'Solutions',
    items: [
      { t: 'Exploratory analysis', d: 'Go from quick question to deep analysis to data app in one place' },
      { t: 'Business intelligence', d: 'Governed self-serve and dashboards for the entire org' },
      { t: 'Embedded analytics', d: 'Ship secure, customer-facing data experiences' },
      { t: 'Integrations', d: 'Out-of-the-box connections and flexible APIs' },
      { t: 'AI & agents', d: 'Agentic workflows to empower your entire team' },
      { t: 'Explore all solutions', d: 'One connected system — infinite data answers' },
    ],
  },
  {
    id: 'resources', label: 'Resources',
    items: [
      { t: 'Switching to Hex', d: 'A guide to getting started on agentic analytics' },
      { t: 'Templates', d: 'Jumpstart with pre-built projects' },
      { t: 'Docs', d: 'Resources and product guides' },
      { t: 'Changelog', d: 'Product updates' },
      { t: 'Blog', d: 'From data teams to data teams' },
      { t: 'Guides', d: 'Learn how to do more with data, together' },
      { t: 'Events', d: 'Learn and connect with peers' },
      { t: 'Customer stories', d: 'Empowering the best data teams' },
      { t: 'Partners', d: 'Learn more about our partnerships' },
    ],
  },
];

/* trusted-by wall — real logo SVGs + per-logo hover stories */
type Logo = { src: string; alt: string; story?: { q: string; by: string } };
const LOGOS: Logo[] = [
  { src: '/home/logo-reddit.svg', alt: 'Reddit' },
  {
    src: '/home/logo-notion.svg', alt: 'Notion',
    story: { q: '“Our vision for Notion’s data team is that anyone, regardless of technical proficiency, is comfortable using data to answer their own questions — and Hex enables that.”', by: 'Aks Nemana, Data Scientist & Abhishek Modi, AI Software Engineer' },
  },
  { src: '/home/logo-sierra.svg', alt: 'Sierra' },
  { src: '/home/logo-anthropic.svg', alt: 'Anthropic' },
  { src: '/home/logo-lovable.svg', alt: 'Lovable' },
  {
    src: '/home/logo-ramp.svg', alt: 'Ramp',
    story: { q: '“We like to embed Hex dashboards where teams work.”', by: 'Ian Macomber, Head of Data and Analytics Engineering' },
  },
  { src: '/home/logo-rivian.svg', alt: 'Rivian' },
  {
    src: '/home/logo-figma.svg', alt: 'Figma',
    story: { q: '“With Hex’s Notebook Agent, I never have to build another chart again? What a dream come true.”', by: 'Rie McGiwer, AI Insights Researcher and Molly Jane Nicholas, Senior Researcher' },
  },
  { src: '/home/logo-brex.svg', alt: 'Brex' },
  { src: '/home/logo-cursor.svg', alt: 'Cursor' },
  { src: '/home/logo-aws.svg', alt: 'AWS' },
  { src: '/home/logo-sedgwick.svg', alt: 'Sedgwick' },
  {
    src: '/home/logo-stubhub.svg', alt: 'StubHub',
    story: { q: '“Hex has helped us empower business analysts to explore and dig into data on their own”', by: 'Meghana Reddy, Head of Data' },
  },
  {
    src: '/home/logo-mercor.svg', alt: 'Mercor',
    story: { q: '“Hex’s Notebook Agent’s ability to build reports increases our operational speed — days into hours, which for our business, is millions of dollars.”', by: 'Dhaval Patel, Account Lead' },
  },
  { src: '/home/logo-thinking-machines.svg', alt: 'Thinking Machines' },
  { src: '/home/logo-surge.svg', alt: 'Surge AI' },
  {
    src: '/home/logo-neo.svg', alt: 'Neo',
    story: { q: '“Hex’s Slack integration unlocked silos of data, in governed ways, increasing trusted answers and insights.”', by: 'Brandon Rochon, VP of Data & Analytics and David Adair, Group Product Manager for Cards and Lending' },
  },
  {
    src: '/home/logo-chime.svg', alt: 'Chime',
    story: { q: '“Hex’s Context Studio and Evals give us the visibility needed to manage our context at scale.”', by: 'Jordan Farrer, Director of Data Science & Analytics' },
  },
];

/* the agent-logo stack beside "Ask a question" */
const AGENT_LOGOS = [
  '/home/icon-chatgpt.svg', '/home/icon-claude.svg', '/home/icon-slack.svg',
  '/home/icon-cli.svg', '/home/icon-mcp.svg',
];

/* alternating feature rows */
type FeatureRow = {
  id: string; icon: string; title: string; cta: string;
  quote: string; who: string; logo?: string;
  img: string; imgAlt: string; flip?: boolean;
};
const ROWS: FeatureRow[] = [
  {
    id: 'ask', icon: 'threads',
    title: 'Ask a question, get a trusted answer',
    cta: 'Explore self-serve insights',
    quote: '“The ability to use Hex in any way we choose is valuable because now we can connect into Hex via my favorite dev tools.”',
    who: 'Nithin Bose', logo: '/home/logo-langchain.svg',
    img: '/home/mock-cluster.png', imgAlt: 'Chat with the Hex Agent notebook, plus Claude, Slack and CLI cards',
  },
  {
    id: 'context', icon: 'semanticModels', flip: true,
    title: 'Ground every answer in your organization’s context',
    cta: 'Explore the Context Engine',
    quote: '“It’s something I check every day — seeing context gaps and suggested improvements surfaced automatically provides a practical way for us to bring trusted AI self-service to the business.”',
    who: 'Craig W.', logo: '/cs/zoe-logo.svg',
    img: '/home/orbit.png', imgAlt: 'Compounding context cycle — build apps and ask questions, auto-detect gaps, sharpen the context',
  },
  {
    id: 'apps', icon: 'apps',
    title: 'Share insights with generative dashboards and data apps',
    cta: 'Explore AI app building',
    quote: '“With Hex’s Notebook Agent, I never have to build another chart again? What a dream come true.”',
    who: 'Molly Jane Nicholas', logo: '/home/logo-figma.svg',
    img: '', imgAlt: '',
  },
  {
    id: 'evals', icon: 'cli', flip: true,
    title: 'See what people are asking, and whether the answers are right',
    cta: 'Explore the Context Studio',
    quote: '“We have so many people and products that our context is never stagnant. Even when we launch a new data domain for the first time, it’s already stale the next day. Hex’s Context Studio gives us the visibility needed to manage our context at scale.”',
    who: 'Jordan Farrer', logo: '/home/logo-chime.svg',
    img: '/home/evals.png', imgAlt: 'Context Studio observability dashboard with an Evals run window',
  },
];

/* ethos pair */
const ETHOS = [
  {
    tag: 'Flexible by design', tagCls: 'gold',
    img: '/home/ethos-token-spend.png',
    h: 'Work with any data, any AI model, and any context, so you aren’t locked in',
    body: 'Your AI bill is getting big — but you don’t know who is spending how much on what things, and whether they’re actually valuable.',
    lead: 'Hex helps you get control of this:',
    list: [
      'Model choice, including open source models',
      'Thread-level observability into token spend, so you can see who is spending what on which projects',
      'Eval sweeps that let you dial in the price / quality frontier across models',
    ],
    cta: 'Explore how Hex keeps you flexible',
  },
  {
    tag: 'Control without compromise', tagCls: 'blue',
    img: '/home/ethos-trust.png',
    h: 'Secure your data, with enterprise-grade permissions and trust',
    body: 'Hex is built so organizations can open up access without giving up control.',
    body2: 'Bring AI and data work onto a platform backed by enterprise-grade security, governance, organization controls, and visibility into how your data is being used.',
    body3: 'The infrastructure stays rigorous so the people using it don’t have to think about it.',
    cta: 'Explore Trust Center',
  },
];

const TESTIS = [
  {
    logo: '/home/logo-mercor.svg', alt: 'Mercor',
    q: '“If we didn’t have Hex, we might’ve left more than $100M on the table. That might even be an underestimate.”',
    who: 'Dhaval P.', role: 'Account Lead',
  },
  {
    logo: '/home/logo-algolia.svg', alt: 'Algolia',
    q: '“AI can do almost everything for you in Hex. I use it to scaffold entire apps and help me debug SQL queries. It makes me 10x faster.”',
    who: 'Tom C.', role: 'Principal Engineer',
  },
];

const USE_CASES = [
  {
    t: 'Migrate from traditional BI to modern AI-powered self-serve',
    d: 'Move beyond static dashboards and give teams trusted, AI-powered access to the data they need while keeping your data team in control of the foundation.',
    ic: 'sparkle',
  },
  {
    t: 'Build a Context Layer for AI on data',
    d: 'Bring business logic, definitions, models, and institutional knowledge together so agents can reason from shared, trusted context and improve as that context grows.',
    ic: 'layers',
  },
  {
    t: 'Make chat apps work with data',
    d: 'Let teams work from Claude, Codex, Cursor, or wherever they’re most productive while Hex provides a consistent layer of trusted data and organizational context underneath.',
    ic: 'chat',
  },
];

const STORIES = [
  { logo: '/home/logo-notion.svg', alt: 'Notion', h: 'One place for insights', p: 'Notion made Hex the one place for everyone, from data science to CX and sales, to make decisions with data.' },
  { logo: '/home/logo-mercor.svg', alt: 'Mercor', h: 'Scaling self-serve AI analytics', p: 'Mercor democratizes analysis across their org with Notebook Agent.' },
  { logo: '/home/logo-figma.svg', alt: 'Figma', h: 'Lowering barriers to insight', p: 'Figma’s team focuses on strategy over syntax using Hex’s AI agents.' },
  { logo: '/home/logo-neo.svg', alt: 'Neo', h: 'Breaking data silos', p: 'Neo drives insights right where they work using Threads and Slack integration.' },
];

const INTS = [
  { img: '/home/int-warehouse.png', alt: 'Built for the warehouse — Snowflake, BigQuery, Databricks connections' },
  { img: '/home/int-dbt.png', alt: 'dbt metadata, docs, & metrics' },
  { img: '/home/int-oauth.png', alt: 'Connect to your warehouse with oAuth' },
  { img: '/home/int-git.png', alt: 'Git it together — export to GitHub or GitLab' },
  { img: '/home/int-orch.png', alt: 'Orchestration — Airflow, Dagster, Prefect' },
  { img: '/home/int-api.png', alt: 'Hex API' },
];

const FAQS = [
  {
    q: 'What is Hex?',
    a: 'Hex is the AI Analytics Platform where trust meets insight: a single, connected workspace where data practitioners run deep analysis, business users ask questions in plain language, and everyone collaborates on the same data. A shared context engine ensures every AI-generated insight is accurate and consistent.',
  },
  {
    q: 'Who uses Hex?',
    a: 'Hex allows anyone to get answers from data with AI. Whether you’re a member of the data team running code-based experiments or a business user looking to self-serve a one-off question, Hex provides tailored AI-workflows for you to find answers from data, faster.',
  },
  {
    q: 'Why do data teams switch to Hex?',
    a: 'Data teams switch to Hex because it gives them one connected, AI-native workspace for everything they do with data. Deep analysis, one-off questions, and critical business dashboards all happen on the same trusted context. Instead of juggling separate notebooks, BI tools, and ad-hoc Slack requests, Hex brings data work & AI together in one place.',
  },
  {
    q: 'Can business users access data without knowing SQL or Python?',
    a: 'Yes. Hex lets anyone ask questions in plain language in Hex, Slack, or via MCP and get AI-generated analysis backed by your actual data, metrics, and business rules. No SQL, no Python, no ticket to the data team. And when a question needs deeper investigation, a data practitioner can jump directly into the same workflow without switching context.',
  },
  {
    q: 'How does Hex ensure AI answers are accurate and trustworthy?',
    a: 'Hex’s context engine combines database descriptions, semantic models, business rules, and analytical logic into one curated layer that powers every AI answer. Data teams can observe what’s being asked, catch inconsistencies, and continuously improve context over time. The result: business users get answers they can act on, and data teams maintain visibility and control over every insight.',
  },
  {
    q: 'How is Hex different from just using ChatGPT, Claude, Codex, or any other AI assistant?',
    a: 'ChatGPT, Claude, Codex, and other AI assistants can generate answers. Hex helps teams build more trustworthy, repeatable AI-powered analysis by grounding it in the organization’s data, business context, and definitions. Context Studio makes it easier to inspect and improve that context, while built-in evals let teams test changes before production and measure their impact on agent accuracy.',
  },
  {
    q: 'How is Hex different than point solution analytics tools?',
    a: 'Hex enables you to bring all your business’s critical data context into one workspace. Solution-specific analytics platforms exacerbate tool sprawl and siloed workflows between teams, while creating governance gaps leading to poor decisions and thrash.',
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

/** bordered link-button used inside feature rows */
function LinkBox({ children }: { children: React.ReactNode }) {
  return (
    <a href="#enter" className="cs-linkbox" onClick={(e) => e.preventDefault()}>
      {children}
    </a>
  );
}

/** inline quote under a feature row — hollow-circle quote mark + text + byline */
function RowQuote({ q, who, logo }: { q: string; who: string; logo?: string }) {
  return (
    <figure className="cs-rquote">
      <i className="cs-rquote-mark" aria-hidden>
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M6.5 4C4.5 4.6 3 6.4 3 8.7V11h4V7.5H4.9c0-1.2.7-2.1 1.9-2.6L6.5 4Zm6 0c-2 .6-3.5 2.4-3.5 4.7V11h4V7.5h-2.1c0-1.2.7-2.1 1.9-2.6L12.5 4Z" fill="currentColor" /></svg>
      </i>
      <blockquote>{q}</blockquote>
      <figcaption>
        <b>{who}</b>
        {logo && <img src={logo} alt="" className="cs-rquote-logo" />}
      </figcaption>
    </figure>
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

  /* footer clock (ICT) — the homepage's segment display */
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

      {/* ---------- hero — centered, cartesian paper grid ---------- */}
      <header className="hx-hero">
        <div className="hx-hero-bg" aria-hidden>
          <div className="hx-hero-grid-bg" />
          <div className="hx-hero-fade" />
        </div>
        <div className="hx-hero-inner">
          <h1 className="hx-h1" data-reveal>
            <Sparkle />
            The Analytics platform<br />
            <em>for humans and agents</em>
          </h1>
          <p className="hx-hero-sub" data-reveal>
            Rethinking{' '}
            <a href="#" className="hx-chip" onClick={(e) => e.preventDefault()}>
              <i className="hx-chip-spot c-teal"><HxIcon d={I.notebook} size={12} /></i>BI
            </a>{' '}
            <a href="#" className="hx-chip" onClick={(e) => e.preventDefault()}>
              <i className="hx-chip-spot c-rose"><HxIcon d={I.threads} size={12} /></i>Conversational analytics
            </a>{' '}
            and{' '}
            <a href="#" className="hx-chip" onClick={(e) => e.preventDefault()}>
              <i className="hx-chip-spot c-blue"><HxIcon d={I.semanticModels} size={12} /></i>Context management
            </a>{' '}
            for the agentic era.
          </p>
          <div className="hx-hero-cta" data-reveal>
            <HxLink href="#enter">Get started for free</HxLink>
            <HxLink href="#enter" variant="ghost">Request a demo</HxLink>
          </div>
        </div>
      </header>

      {/* ---------- trusted-by wall ---------- */}
      <section className="cs-trust cs-marks" data-reveal>
        <i className="m-tl" aria-hidden /><i className="m-tr" aria-hidden />
        <i className="m-bl" aria-hidden /><i className="m-br" aria-hidden />
        <p className="cs-trust-label mono">
          <i className="cs-cap cs-cap-l" aria-hidden />
          Trusted by leading data companies
          <i className="cs-cap cs-cap-r" aria-hidden />
        </p>
        <div className="hx-logo-wall">
          {LOGOS.map((l) => (
            <div key={l.alt} className={`hx-logo-cell${l.story ? ' has-story' : ''}`}>
              {l.story && <i className="hx-story-dot" aria-hidden />}
              <img src={l.src} alt={l.alt} loading="lazy" />
              {l.story && (
                <div className="hx-story" role="tooltip">
                  <p>{l.story.q}</p>
                  <span className="mono">{l.story.by}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ---------- a different approach ---------- */}
      <section className="cs-sec hx-approach" id="approach">
        <img src="/home/connector.svg" className="hx-connector" alt="" aria-hidden />
        <div className="hx-float hx-f1" aria-hidden><img src="/home/icon-claude.svg" alt="" /></div>
        <div className="hx-float hx-f2" aria-hidden><img src="/home/icon-slack.svg" alt="" /></div>
        <div className="hx-float hx-f3" aria-hidden><img src="/home/icon-chatgpt.svg" alt="" /></div>
        <div className="hx-float hx-f4 mono" aria-hidden>?</div>
        <h2 className="cs-h2" data-reveal>A different approach to Analytics and BI</h2>
        <p className="cs-sub2" data-reveal>
          BI tools, chat apps, and vibe-coding only give you inconsistent answers
          and poor user experience. Hex is built with a full suite of tools to
          unlock your team’s curiosity while maintaining trust and governance.
        </p>
      </section>

      {/* ---------- feature rows ---------- */}
      <section className="hx-rows">
        {ROWS.map((r) => (
          <div key={r.id} className={`hx-row${r.flip ? ' is-flip' : ''}`} data-reveal>
            <div className="hx-row-copy">
              <i className="hx-row-icon" aria-hidden>
                <HxIcon d={I[r.icon as keyof typeof I]} size={26} />
              </i>
              {r.id === 'ask' && (
                <div className="hx-agent-stack" aria-hidden>
                  {AGENT_LOGOS.map((s) => <img key={s} src={s} alt="" />)}
                </div>
              )}
              <h3>{r.title}</h3>
              <LinkBox>{r.cta}</LinkBox>
              <RowQuote q={r.quote} who={r.who} logo={r.logo} />
            </div>
            <div className="hx-row-art">
              {r.id === 'apps' ? (
                <div className="hx-appcards">
                  <img src="/home/card-market.png" alt="Market explorer app" loading="lazy" />
                  <img src="/home/card-revenue.png" alt="NexaCorp revenue report app" loading="lazy" />
                  <img src="/home/card-pricing.png" alt="Pricing forecast app" loading="lazy" />
                  <img src="/home/card-nexacorp.png" alt="Priority-account board app" loading="lazy" />
                </div>
              ) : (
                <img src={r.img} alt={r.imgAlt} loading="lazy" />
              )}
            </div>
          </div>
        ))}
      </section>

      {/* ---------- ethos pair ---------- */}
      <section className="cs-sec hx-ethos" id="ethos">
        <div className="hx-ethos-grid">
          {ETHOS.map((c) => (
            <div key={c.tag} className="hx-ethos-card" data-reveal>
              <span className={`hx-tag mono hx-tag-${c.tagCls}`}>{c.tag}</span>
              <div className="hx-ethos-art"><img src={c.img} alt="" loading="lazy" /></div>
              <h3>{c.h}</h3>
              <p>{c.body}</p>
              {'lead' in c && c.lead && <p>{c.lead}</p>}
              {'list' in c && c.list && (
                <ul>
                  {c.list.map((li) => <li key={li}>{li}</li>)}
                </ul>
              )}
              {'body2' in c && c.body2 && <p>{c.body2}</p>}
              {'body3' in c && c.body3 && <p>{c.body3}</p>}
              <LinkBox>{c.cta}</LinkBox>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- two-up testimonials ---------- */}
      <section className="cs-testi" data-reveal>
        {TESTIS.map((t) => (
          <div key={t.alt} className="cs-testi-cell">
            <img src={t.logo} alt={t.alt} className="cs-testi-logo" />
            <p>{t.q}</p>
            <div><b>{t.who}</b><span className="mono">{t.role}</span></div>
          </div>
        ))}
      </section>

      {/* ---------- use cases ---------- */}
      <section className="cs-sec hx-uc" id="use-cases">
        <div className="hx-uc-inner" data-reveal>
          <div className="hx-uc-head">
            <h2 className="hx-uc-h2"><span>Use cases</span><em>Get the most out of Hex</em></h2>
          </div>
          <div className="hx-uc-rows">
          {USE_CASES.map((u) => (
            <a key={u.t} href="#" className="hx-uc-row" onClick={(e) => e.preventDefault()}>
              <i className={`hx-uc-ic hx-ic-${u.ic}`} aria-hidden>
                {u.ic === 'sparkle' && <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 1l1.8 5.2L17 4.5l-3.4 4.5L18 11l-5.4 1 2 5.5-4.6-3.6L6 17.5l1.4-5.5L2 10l5.4-.8L10 1z" fill="currentColor" opacity=".9" /></svg>}
                {u.ic === 'layers' && <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2l8 4-8 4-8-4 8-4zM3 10.5l7 3.5 7-3.5M3 14l7 3.5L17 14" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>}
                {u.ic === 'chat' && <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 4h14v10H9l-4 3.5V14H3V4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><circle cx="7" cy="9" r="1" fill="currentColor" /><circle cx="10.5" cy="9" r="1" fill="currentColor" /><circle cx="14" cy="9" r="1" fill="currentColor" /></svg>}
              </i>
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

      {/* ---------- loved by ---------- */}
      <section className="cs-sec hx-loved" id="customers">
        <h2 className="cs-h2" data-reveal>
          <em>Loved</em> by the<br />best data teams
        </h2>
        <p className="cs-sub2" data-reveal>Hex helps companies of all sizes do more with their data.</p>
        <div className="hx-loved-frame cs-marks" data-reveal>
          <i className="m-tl" aria-hidden /><i className="m-tr" aria-hidden />
          <i className="m-bl" aria-hidden /><i className="m-br" aria-hidden />
          <div className="hx-stories">
            {STORIES.map((s) => (
              <a key={s.alt} href="#" className="hx-story-col" onClick={(e) => e.preventDefault()}>
                <img src={s.logo} alt={s.alt} className="hx-story-logo" />
                <h4>{s.h}</h4>
                <p>{s.p}</p>
                <span className="hx-readmore">Read more<HxIcon d={I.arrowR} size={10} /></span>
              </a>
            ))}
          </div>
          <div className="hx-loved-foot">
            <div className="hx-g2">
              <h3>Users love Hex</h3>
              <img src="/home/g2-awards.svg" alt="Three G2 badges received by Hex for High Performer, Best Support, and Momentum Leader" loading="lazy" />
              <p>Rated on G2 as an industry leader based on customer reviews. <a href="#" onClick={(e) => e.preventDefault()}>Check them out<HxIcon d={I.arrowR} size={10} /></a></p>
            </div>
            <blockquote className="hx-nquote">
              <img src="/home/logo-notion.svg" alt="Notion" className="hx-nquote-logo" />
              <svg className="hx-nquote-mark" width="60" height="40" viewBox="0 0 60 40" fill="none" aria-hidden><text x="0" y="38" fontSize="52" fill="currentColor" fontFamily="Georgia,serif">”</text></svg>
              <p>“Our vision for Notion’s data team is that anyone, regardless of technical proficiency, is comfortable using data to answer their own questions — and Hex enables that.”</p>
              <footer>
                <img src="/home/headshot-abhishek.jpg" alt="" className="hx-nquote-face" />
                <div><b>Abhishek Modi</b><span className="mono">Software Engineer at Notion</span></div>
              </footer>
            </blockquote>
          </div>
        </div>
      </section>

      {/* ---------- integrations ---------- */}
      <section className="cs-sec hx-int" id="integrations">
        <h2 className="cs-h2" data-reveal>
          <em>Instant integration</em><br />with the whole stack
        </h2>
        <p className="cs-sub2" data-reveal>Out-of-the-box connections and flexible APIs make setup a breeze.</p>
        <div className="hx-int-grid">
          {INTS.map((c) => (
            <a key={c.img} href="#" className="hx-int-card" onClick={(e) => e.preventDefault()} data-reveal>
              <img src={c.img} alt={c.alt} loading="lazy" />
            </a>
          ))}
        </div>
      </section>

      {/* ---------- getting started + token wall ---------- */}
      <section className="hx-start" id="enter">
        <div className="hx-start-row" data-reveal>
          <div className="hx-start-l">
            <h3>Getting started is easy.</h3>
            <p>Connect Hex to your data warehouse and do more with it immediately.</p>
            <div className="hx-start-btns">
              <HxLink href="#enter">Get started for free</HxLink>
              <HxLink href="#enter" variant="ghost">Talk to us</HxLink>
            </div>
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
          <div className="hx-start-r">
            <p>Check out all of our plans to fit your team or organization.</p>
            <HxLink href="#" variant="ghost" onClick={(e) => e.preventDefault()}>See our plans</HxLink>
          </div>
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
            <span className="cs-logo">HEX<sup>®</sup></span>
            <span className="cs-foot-made mono">Made with 💜 on 🌎</span>
            <span className="hx-clock mono" aria-label="Bangkok time">{clock} ICT</span>
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
