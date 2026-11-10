// /dev/ui — the Console 5 component gallery (dev builds only; App.tsx gates
// the route on import.meta.env.DEV so production never ships it). Every
// primitive in every state, in both densities, with a theme switch, so a
// change to a token or component is checked in one place.

import { useState, type ReactNode } from 'react';
import { Badge, Kbd } from '../../ui/Badge';
import { Button, IconButton } from '../../ui/Button';
import { Dialog, Drawer } from '../../ui/Drawer';
import { Checkbox, Combobox, Input, NumberField, Select, Switch } from '../../ui/FormFields';
import { Menu, Popover, Tooltip } from '../../ui/Popover';
import { Tabs } from '../../ui/Tabs';
import { toast } from '../../ui/Toaster';
import { applyTheme, writeThemePref, type ThemePref } from '../../theme/theme';
import { useThemeName } from '../../theme/useTheme';
import { Panel } from '../../viz/Panel';
import { StatTile } from '../../viz/StatTile';
import { BulletBar, Meter } from '../../viz/BulletBar';
import { StateTimeline } from '../../viz/StateTimeline';
import { BarList } from '../../viz/BarList';
import { HeatStrip } from '../../viz/HeatStrip';
import { pareto } from '../../viz/pareto';
import { segments } from '../../viz/timeline';
import type { PanelState } from '../../viz/panelState';
import { KitGallery } from './KitGallery';

/* Gallery-only copy: this page is a developer tool, never shown to users,
   so its labels are not translated. */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-panel border border-line bg-panel p-4 shadow-ply1">
      <h2 className="mb-3 text-[14px] font-semibold">{title}</h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  );
}

const OPTIONS = [
  { value: 'silo3', label: 'Cement silo 3', hint: 'batch/cem/silo3' },
  { value: 'belt1', label: 'Aggregate belt 1', hint: 'batch/agg/belt1' },
  { value: 'mixer', label: 'ไซโลปูน / Mixer', hint: 'batch/mix/mixer' },
];

export function DevUiPage() {
  const theme = useThemeName();
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [num, setNum] = useState<number | null>(45.5);
  const [sw, setSw] = useState(true);
  const [cb, setCb] = useState(false);
  const [combo, setCombo] = useState<string | null>('belt1');
  const [tab, setTab] = useState('a');
  const [drawer, setDrawer] = useState(false);
  const [dialog, setDialog] = useState(false);
  const setTheme = (p: ThemePref) => { writeThemePref(p); applyTheme(p); };

  return (
    <div data-density={density} className="flex flex-col gap-4 bg-ground p-4 text-ink">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-[18px] font-semibold">Console 5 — component gallery</h1>
        <span className="flex-1" />
        <Button size="sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>Theme: {theme}</Button>
        <Button size="sm" onClick={() => setDensity((d) => (d === 'comfortable' ? 'compact' : 'comfortable'))}>Density: {density}</Button>
      </header>

      {/* console v6 kit (D1) — every new component in every state */}
      <KitGallery />

      {/* The older Console 5 viz gallery (BarList) is wider than 390px at its
          own layout; contain it here so /dev/ui itself never scrolls sideways. */}
      <div className="flex min-w-0 flex-col gap-4 overflow-x-auto">
      <Section title="Button">
        {(['primary', 'secondary', 'ghost', 'danger'] as const).map((v) => (
          <div key={v} className="flex flex-col gap-2">
            <Button variant={v}>{v}</Button>
            <Button variant={v} size="sm">{v} sm</Button>
            <Button variant={v} size="lg">{v} lg</Button>
            <Button variant={v} loading>loading</Button>
            <Button variant={v} disabled>disabled</Button>
          </div>
        ))}
        <div className="flex flex-col gap-2">
          <IconButton label="Search">⌕</IconButton>
          <IconButton label="Search (secondary)" variant="secondary">⌕</IconButton>
          <IconButton label="Searching" loading>⌕</IconButton>
        </div>
      </Section>

      <Section title="Badge · Kbd">
        {(['neutral', 'accent', 'crit', 'warn', 'info', 'ok'] as const).map((t) => <Badge key={t} tone={t}>{t}</Badge>)}
        <Badge tone="sim" />
        <Kbd>Ctrl</Kbd><Kbd>K</Kbd>
      </Section>

      <Section title="Popover · Menu · Tooltip">
        <Popover.Root>
          <Popover.Trigger className="h-8 rounded-control border border-line-strong bg-panel px-3 text-[13px]">Open popover</Popover.Trigger>
          <Popover.Content label="Example popover"><p className="max-w-56 p-2 text-[13px]">Top-layer popover — Esc or an outside click closes it.</p></Popover.Content>
        </Popover.Root>
        <Menu.Root>
          <Menu.Trigger className="h-8 rounded-control border border-line-strong bg-panel px-3 text-[13px]">Theme menu</Menu.Trigger>
          <Menu.List label="Theme">
            {(['light', 'dark', 'system'] as const).map((p) => <Menu.Item key={p} checked={p === theme} onSelect={() => setTheme(p)}>{p}</Menu.Item>)}
            <Menu.Item disabled onSelect={() => {}}>disabled item</Menu.Item>
          </Menu.List>
        </Menu.Root>
        <Tooltip label="Tooltips open after 400 ms on hover, at once on focus">
          <button type="button" className="h-8 rounded-control border border-line-strong bg-panel px-3 text-[13px]">Hover or focus me</button>
        </Tooltip>
      </Section>

      <Section title="Drawer · Dialog · Toast">
        <Button onClick={() => setDrawer(true)}>Open drawer</Button>
        <Button onClick={() => setDialog(true)}>Open dialog</Button>
        {(['info', 'ok', 'warn', 'crit'] as const).map((tone) => (
          <Button key={tone} size="sm" onClick={() => toast({ tone, text: `A ${tone} toast` })}>toast {tone}</Button>
        ))}
        <Drawer open={drawer} onClose={() => setDrawer(false)} title="Side sheet" footer={<Button variant="primary" onClick={() => setDrawer(false)}>Done</Button>}>
          <p className="p-4 text-[13px]">Native dialog: focus trap, Esc, scrim — focus returns to the opener.</p>
        </Drawer>
        <Dialog open={dialog} onClose={() => setDialog(false)} title="Confirm" footer={<><Button onClick={() => setDialog(false)}>Cancel</Button><Button variant="danger" onClick={() => setDialog(false)}>Stop belt</Button></>}>
          <p className="text-[13px]">Destructive actions are never the default focus.</p>
        </Dialog>
      </Section>

      <Section title="Fields">
        <div className="grid w-full max-w-3xl gap-3 sm:grid-cols-2">
          <Input label="Tag name" placeholder="belt1/speed" hint="Lower case, slash separated" />
          <Input label="Address" defaultValue="40001x" error="Not a Modbus register" />
          <NumberField label="Setpoint" unit="Hz" min={0} max={60} step={0.5} value={num} onChange={setNum} hint="0 – 60 Hz" />
          <Select label="Protocol" defaultValue="modbus"><option value="modbus">Modbus TCP</option><option value="s7">Siemens S7</option><option value="opcua">OPC UA</option></Select>
          <Combobox label="Equipment" options={OPTIONS} value={combo} onChange={setCombo} placeholder="Search equipment" />
          <div className="flex flex-col gap-2">
            <Switch label="Auto mode" checked={sw} onChange={setSw} />
            <Switch label="Disabled switch" checked={false} onChange={() => {}} disabled />
            <Checkbox label="Acknowledge on read" checked={cb} onChange={setCb} />
          </div>
        </div>
      </Section>

      <VizGallery />

      <Section title="Tabs">
        <div className="w-full max-w-xl">
          <Tabs.Root value={tab} onValueChange={setTab}>
            <Tabs.List label="Gateway">
              <Tabs.Tab value="a">Overview</Tabs.Tab>
              <Tabs.Tab value="b">Sources &amp; tags</Tabs.Tab>
              <Tabs.Tab value="c">Logs</Tabs.Tab>
              <Tabs.Tab value="d" disabled>Settings</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="a"><p className="p-3 text-[13px]">Health timeline and config versions.</p></Tabs.Panel>
            <Tabs.Panel value="b"><p className="p-3 text-[13px]">Sources grouped by device.</p></Tabs.Panel>
            <Tabs.Panel value="c"><p className="p-3 text-[13px]">Edge log stream.</p></Tabs.Panel>
          </Tabs.Root>
        </div>
      </Section>
      </div>
    </div>
  );
}

/* ── R2 viz kit ─────────────────────────────────────────────────────────── */

const NOW = Date.parse('2026-10-26T12:00:00Z');
const wave = (n: number, base: number, amp: number) =>
  Array.from({ length: n }, (_, i) => ({ t: NOW - (n - i) * 60_000, v: base + amp * Math.sin(i / 6) + (i % 7) * 0.1 }));

function VizGallery() {
  const pts = wave(60, 72, 6);
  const run = [{ t: NOW - 8 * 3600_000, v: 1 }, { t: NOW - 6 * 3600_000, v: 0 }, { t: NOW - 5 * 3600_000, v: 1 }, { t: NOW - 3600_000, v: 1 }];
  const states: PanelState[] = ['ready', 'skeleton', 'refetch', 'stale', 'empty', 'error'];
  return (
    <>
      <Section title="StatTile (md · hero · wall)">
        <div className="grid w-full gap-3 md:grid-cols-3">
          <StatTile label="Belt temperature" value={73.4} unit="°C" pts={pts} limits={[{ v: 75, severity: 'critical' }]} ts={new Date().toISOString()} quality="good" />
          <StatTile label="Mixer current" value={91.5} unit="A" pts={wave(60, 85, 8)} limits={[{ v: 90, severity: 'warning' }]} ts={new Date().toISOString()} quality="good" size="hero" />
          <StatTile label="Batches today" value={1418} decimals={0} pts={wave(60, 1400, 10)} sim size="wall" />
        </div>
      </Section>
      <Section title="BulletBar · Meter">
        <div className="grid w-full max-w-3xl gap-4 md:grid-cols-2">
          <BulletBar label="Cement weigh hopper" value={312} unit="kg" target={300} max={400} bands={[250, 350]} tolerance={0.02} />
          <BulletBar label="OEE availability" value={86} unit="%" target={90} max={100} bands={[60, 80]} />
          <Meter label="Silo 3 level" value={62} max={100} unit="%" />
        </div>
      </Section>
      <Section title="StateTimeline · BarList (Pareto) · HeatStrip">
        <div className="grid w-full gap-6 lg:grid-cols-2">
          <StateTimeline from={NOW - 8 * 3600_000} to={NOW} rows={[
            { label: 'Mixer', segs: segments(run, NOW - 8 * 3600_000, NOW, [NOW - 5.5 * 3600_000], 3 * 3600_000) },
            { label: 'Skip hoist', segs: segments([{ t: NOW - 7 * 3600_000, v: 1 }], NOW - 8 * 3600_000, NOW, [], 1e9) },
          ]} />
          <BarList cumulative unit="min" items={pareto([
            { label: 'Material shortage', value: 42 }, { label: 'Changeover', value: 25 }, { label: 'Mixer fault', value: 12 },
            { label: 'Truck late', value: 9 }, { label: 'Other stops', value: 4 }, { label: 'Cleaning', value: 3 },
          ], 4, 'Other')} />
          <div className="lg:col-span-2">
            <HeatStrip label="Alarm density" from={NOW - 4 * 3600_000} to={NOW}
              ts={[1, 2, 2.1, 2.15, 3, 3.5, 3.52, 3.53, 3.54, 3.55].map((h) => NOW - 4 * 3600_000 + h * 3600_000)} />
          </div>
        </div>
      </Section>
      <Section title="Panel states">
        <div className="grid w-full gap-3 md:grid-cols-3">
          {states.map((st) => (
            <Panel.Root key={st} state={st} onRetry={() => {}} className="h-40">
              <Panel.Header title={`State: ${st}`} unit="°C" badge="1h" info="Panel info tooltip" menu={[{ label: 'View in Trends', onSelect: () => {} }]} onFullscreen />
              <Panel.Body><div className="p-3 text-[12px] text-ink-2">Previous render content.</div></Panel.Body>
            </Panel.Root>
          ))}
        </div>
      </Section>
    </>
  );
}
