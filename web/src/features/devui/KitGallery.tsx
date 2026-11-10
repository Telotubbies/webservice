// Console v6 kit gallery (plan §5 D1). Every new component in every state,
// in EN and TH (switch the app language). Dev-only: /dev/ui is gated on
// import.meta.env.DEV in App.tsx.

import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DdIcon } from '../../shared/ui/DdIcon';
import { BottomDock, CommandChip, ConnPill, InfoBanner, IoPanel, RunBar, SectionTag, Toolbar, ToolButton, ToolGroup } from '../../shared/ui/ConsoleKit';
import { DataGrid, type DataGridColumn, type GridRowState } from '../../shared/ui/DataGrid';
import { Readout } from '../../shared/ui/Readout';
import './i18n';

function Panel({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section data-kit={id} className="min-w-0 rounded-[5px] border border-line bg-paper p-3 shadow-card">
      <h2 className="text-[14px] font-semibold">{title}</h2>
      {note && <p className="mt-1 max-w-[80ch] text-[12px] leading-snug text-ink-46">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

const SWATCHES = [
  '--color-readout', '--color-readout-ink', '--color-readout-dim', '--color-row-selected',
  '--color-cmd-home', '--color-cmd-move', '--color-cmd-set', '--color-cmd-wait',
  '--color-cmd-loop', '--color-cmd-end', '--color-cmd-other',
];

interface Equipment {
  id: string; num: number; name: string; tag: string;
  value: number; unit: string; setpoint: number;
  lo: number | null; hi: number | null;
  cmd: string; cmdAt: string; state: string;
  quality: 'good' | 'low' | 'high' | 'stale' | 'bad';
}

export function KitGallery() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>('skip');
  const [openId, setOpenId] = useState<string | null>(null);
  const [ioTab, setIoTab] = useState('di');
  const [dockTab, setDockTab] = useState('log');
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [dock2Tab, setDock2Tab] = useState('events');

  const rows = useMemo<Equipment[]>(() => [
    { id: 'mixer', num: 1, name: t('kit.grid.row.mixer'), tag: 'batch.mix.mixer1.current_a', value: 48.2, unit: 'A', setpoint: 50, lo: null, hi: 62, cmd: 'START', cmdAt: '07:42', state: t('kit.grid.running'), quality: 'good' },
    { id: 'skip', num: 2, name: t('kit.grid.row.skip'), tag: 'batch.agg.skip1.position_pct', value: 72.4, unit: '%', setpoint: 70, lo: 5, hi: 95, cmd: 'MOVE', cmdAt: '07:55', state: t('kit.grid.moving'), quality: 'good' },
    { id: 'silo1', num: 3, name: t('kit.grid.row.silo1'), tag: 'batch.cem.silo1.level_pct', value: 18.6, unit: '%', setpoint: 40, lo: 20, hi: 98, cmd: '—', cmdAt: '—', state: t('kit.grid.normal'), quality: 'low' },
    { id: 'tank', num: 4, name: t('kit.grid.row.tank'), tag: 'batch.liq.tank1.level_pct', value: 81.3, unit: '%', setpoint: 80, lo: 15, hi: 95, cmd: '—', cmdAt: '—', state: t('kit.grid.normal'), quality: 'good' },
    { id: 'pump', num: 5, name: t('kit.grid.row.pump'), tag: 'batch.liq.pump1.flow_lpm', value: 0, unit: 'L/min', setpoint: 120, lo: null, hi: 220, cmd: 'STOP', cmdAt: '07:30', state: t('kit.grid.stopped'), quality: 'good' },
    { id: 'dust', num: 6, name: t('kit.grid.row.dust'), tag: 'batch.air.filter1.dp_mbar', value: 14.9, unit: 'mbar', setpoint: 12, lo: null, hi: 12, cmd: '—', cmdAt: '—', state: t('kit.grid.normal'), quality: 'high' },
    { id: 'hopper', num: 7, name: t('kit.grid.row.hopper'), tag: 'batch.agg.weigh1.weight_kg', value: 1240, unit: 'kg', setpoint: 1240, lo: null, hi: 2000, cmd: 'TARE', cmdAt: '07:51', state: t('kit.grid.normal'), quality: 'stale' },
  ], [t]);

  // setpoints typed in the grid survive a language switch, row names do not
  // (they come from t()), so the two are kept apart.
  const [setpoints, setSetpoints] = useState<Record<string, number>>({});
  const list = rows.map((r) => (setpoints[r.id] == null ? r : { ...r, setpoint: setpoints[r.id] }));

  function commitSetpoint(row: Equipment, value: string) {
    const n = Number(value);
    if (Number.isFinite(n)) setSetpoints((prev) => ({ ...prev, [row.id]: n }));
  }

  const columns: DataGridColumn<Equipment>[] = [
    { key: 'num', header: t('kit.grid.num'), numeric: true, width: '40px' },
    { key: 'name', header: t('kit.grid.name') },
    { key: 'tag', header: t('kit.grid.tag') },
    { key: 'value', header: t('kit.grid.value'), group: t('kit.grid.live'), numeric: true, decimals: 1 },
    { key: 'unit', header: t('kit.grid.unit'), group: t('kit.grid.live') },
    { key: 'setpoint', header: t('kit.grid.setpoint'), group: t('kit.grid.live'), numeric: true, edit: { inputLabel: t('kit.grid.setpoint'), onCommit: commitSetpoint } },
    { key: 'lo', header: t('kit.grid.lo'), group: t('kit.grid.limits'), numeric: true },
    { key: 'hi', header: t('kit.grid.hi'), group: t('kit.grid.limits'), numeric: true },
    { key: 'cmd', header: t('kit.grid.lastCommand'), render: (row) => row.cmd === '—' ? <span className="text-ink-46">—</span> : <span className="whitespace-nowrap"><CommandChip code={row.cmd} label={row.cmd} /><span className="ml-1.5 text-[11px] text-ink-46">{row.cmdAt}</span></span> },
    { key: 'state', header: t('kit.grid.state') },
    {
      key: 'quality', header: t('kit.grid.quality'),
      render: (row) => {
        if (row.quality === 'low') return <span className="inline-flex items-center gap-1 whitespace-nowrap text-[var(--color-caution-ink)]"><DdIcon name="attention-circled" size={13} />{t('kit.grid.lowLevel')}</span>;
        if (row.quality === 'high') return <span className="inline-flex items-center gap-1 whitespace-nowrap text-[var(--color-danger)]"><DdIcon name="attention-circled" size={13} />{t('kit.grid.highDiff')}</span>;
        if (row.quality === 'stale') return <span className="inline-flex items-center gap-1 whitespace-nowrap text-ink-46"><DdIcon name="clock" size={13} />{t('kit.grid.stale')}</span>;
        if (row.quality === 'bad') return <span className="inline-flex items-center gap-1 whitespace-nowrap text-[var(--color-danger)]"><DdIcon name="cancel-circled" size={13} />{t('kit.readout.bad')}</span>;
        return t('kit.grid.good');
      },
    },
  ];

  const stateOf = (row: Equipment): GridRowState => (row.quality === 'stale' ? 'stale' : row.quality === 'bad' ? 'error' : 'normal');
  const open = list.find((r) => r.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-3 bg-ground p-3 text-ink">
      <header>
        <h1 className="text-[18px] font-semibold">{t('kit.title')}</h1>
        <p className="mt-1 max-w-[90ch] text-[13px] leading-snug text-ink-46">{t('kit.lede')}</p>
      </header>

      <Panel id="tokens" title={t('kit.tokens.title')} note={t('kit.tokens.note')}>
        <ul className="flex flex-wrap gap-3">
          {SWATCHES.map((name) => (
            <li key={name} className="w-28">
              <span className="block h-8 rounded-[4px] border border-line" style={{ background: `var(${name})` }} />
              <code className="mt-1 block break-words text-[10px] leading-tight text-ink-68">{name}</code>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel id="toolbar" title={t('kit.toolbar.title')}>
        <Toolbar label={t('kit.toolbar.title')} trailing={<ConnPill state="live" stateLabel={t('kit.conn.live')} detailLabel={t('kit.conn.liveDetail')} />}>
          <ToolGroup label={t('kit.toolbar.operate')}>
            <ToolButton icon="refresh" label={t('kit.toolbar.refresh')} />
            <ToolButton icon="prompt" label={t('kit.toolbar.command')} active />
            <ToolButton icon="check" label={t('kit.toolbar.acknowledge')} />
            <ToolButton icon="prompt" label={t('kit.toolbar.ioMap')} disabled disabledReason={t('kit.toolbar.disabledReason')} />
          </ToolGroup>
          <ToolGroup label={t('kit.toolbar.setup')}>
            <ToolButton icon="cog" label={t('kit.toolbar.limits')} />
          </ToolGroup>
        </Toolbar>
        <p className="mt-2 flex flex-wrap gap-3 text-[11px] text-ink-46">
          <span>{t('kit.toolbar.stateNormal')}</span>
          <span>{t('kit.toolbar.stateActive')}</span>
          <span>{t('kit.toolbar.stateDisabled')}</span>
        </p>
      </Panel>

      <Panel id="tag" title={t('kit.tag.title')}>
        <div className="flex flex-wrap items-center gap-2">
          <SectionTag>{t('kit.tag.equipment')}</SectionTag>
          <SectionTag>{t('kit.tag.selected')}</SectionTag>
          <SectionTag>{t('kit.tag.limits')}</SectionTag>
        </div>
      </Panel>

      <Panel id="readout" title={t('kit.readout.title')}>
        <div className="grid gap-3 md:grid-cols-3">
          <Readout
            label={t('kit.readout.position')} value={72.4} unit="%" min={0} max={100}
            limits={{ lo: 5, hi: 95 }} loText={t('kit.readout.lo')} hiText={t('kit.readout.hi')}
            dims={[
              { label: t('kit.readout.motorTemp'), value: '61.2 °C' },
              { label: t('kit.readout.state'), value: t('kit.readout.moving') },
              { label: t('kit.readout.updated'), value: '0.4 s' },
            ]}
            state="live" stateLabel={t('kit.readout.live')}
          />
          <Readout
            label={t('kit.readout.level')} value={18.6} unit="%" min={0} max={100}
            limits={{ lo: 20, hi: 98 }} loText={t('kit.readout.lo')} hiText={t('kit.readout.hi')}
            dims={[
              { label: t('kit.readout.state'), value: t('kit.grid.normal') },
              { label: t('kit.readout.quality'), value: t('kit.grid.good') },
              { label: t('kit.readout.updated'), value: '2 min' },
            ]}
            state="stale" stateLabel={t('kit.readout.stale')}
          />
          <Readout
            label={t('kit.readout.level')} value={-1} unit="%" min={0} max={100}
            dims={[
              { label: t('kit.readout.state'), value: t('kit.grid.stopped') },
              { label: t('kit.readout.quality'), value: t('kit.readout.bad') },
              { label: t('kit.readout.updated'), value: '—' },
            ]}
            state="error" stateLabel={t('kit.readout.bad')}
          />
        </div>
      </Panel>

      <Panel id="grid" title={t('kit.grid.title')} note={t('kit.grid.hint')}>
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <SectionTag>{t('kit.grid.equipment')}</SectionTag>
          <SectionTag>{t('kit.tag.selected')}</SectionTag>
        </div>
        <DataGrid
          label={t('kit.grid.title')} columns={columns} rows={list} dense maxHeight={340}
          selectedId={selected} onSelect={(row) => setSelected(row.id)} onOpen={(row) => setOpenId(row.id)}
          getRowState={stateOf}
        />
        <div data-kit="inspector" className="mt-3 rounded-[5px] border border-line bg-subtle p-3">
          <h3 className="text-[13px] font-semibold">{t('kit.inspector.title')}</h3>
          {open ? (
            <p className="mt-1 text-[13px] leading-relaxed">
              <strong>{open.name}</strong> · {open.tag}
              <br />
              {t('kit.inspector.valueLine', { value: open.value, unit: open.unit, lo: open.lo ?? '—', hi: open.hi ?? '—' })}
              <br />
              {open.state} · {open.cmd}
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-ink-46">{t('kit.inspector.hint')}</p>
          )}
        </div>
        <h3 className="mb-1 mt-4 text-[13px] font-semibold">{t('kit.grid.empty')}</h3>
        <DataGrid label={t('kit.grid.empty')} columns={columns.slice(0, 4)} rows={[]} dense emptyLabel={t('kit.grid.empty')} />
      </Panel>

      <Panel id="chip" title={t('kit.chip.title')} note={t('kit.chip.note')}>
        <div className="flex flex-wrap items-center gap-2">
          <CommandChip code="HOME" label="HOME" />
          <CommandChip code="MOVE" label="MOVE" />
          <CommandChip code="SET OUT" label="SET OUT" />
          <CommandChip code="WAIT" label="WAIT" />
          <CommandChip code="LOOP" label="LOOP" />
          <CommandChip code="END" label="END" />
          <CommandChip code="STOP" label={t('kit.chip.unmapped')} />
        </div>
      </Panel>

      <Panel id="run" title={t('kit.run.title')}>
        <div className="flex flex-col gap-2">
          <RunBar state="idle" status={t('kit.run.idle')} onRun={() => {}} onStep={() => {}} onPause={() => {}} onStop={() => {}}
            labels={{ run: t('kit.run.run'), step: t('kit.run.step'), pause: t('kit.run.pause'), stop: t('kit.run.stop') }} />
          <RunBar state="running" status={t('kit.run.running')} onRun={() => {}} onStep={() => {}} onPause={() => {}} onStop={() => {}}
            labels={{ run: t('kit.run.run'), step: t('kit.run.step'), pause: t('kit.run.pause'), stop: t('kit.run.stop') }} />
          <RunBar state="paused" status={t('kit.run.paused')} onRun={() => {}} onStop={() => {}}
            labels={{ run: t('kit.run.run'), step: t('kit.run.step'), pause: t('kit.run.pause'), stop: t('kit.run.stop') }} />
          <RunBar state="idle" status={t('kit.run.idle')} disabled
            labels={{ run: t('kit.run.run'), step: t('kit.run.step'), pause: t('kit.run.pause'), stop: t('kit.run.stop') }} />
        </div>
      </Panel>

      <Panel id="io" title={t('kit.io.title')}>
        <div className="grid gap-3 md:grid-cols-2">
          <IoPanel
            title={t('kit.io.panel')} tabs={[{ id: 'di', label: t('kit.io.di'), count: 3 }, { id: 'do', label: t('kit.io.do'), count: 2 }]}
            active={ioTab} onTab={setIoTab}
            items={ioTab === 'di'
              ? [
                { id: 'd1', label: t('kit.io.item.skipTop'), on: true },
                { id: 'd2', label: t('kit.io.item.skipBottom'), on: false },
                { id: 'd3', label: t('kit.io.item.door'), on: false },
              ]
              : [
                { id: 'o1', label: t('kit.io.item.truck'), on: true },
                { id: 'o2', label: t('kit.io.item.gate'), on: true },
              ]}
            onLabel={t('kit.io.on')} offLabel={t('kit.io.off')} emptyLabel={t('kit.io.empty')}
          />
          <IoPanel
            title={t('kit.io.panel')} tabs={[{ id: 'spare', label: t('kit.io.spare') }]} active="spare" onTab={() => {}}
            items={[]} onLabel={t('kit.io.on')} offLabel={t('kit.io.off')} emptyLabel={t('kit.io.empty')}
          />
        </div>
      </Panel>

      <Panel id="banner" title={t('kit.banner.title')}>
        <InfoBanner>{t('kit.banner.text')}</InfoBanner>
      </Panel>

      <Panel id="dock" title={t('kit.dock.title')}>
        <div className="flex flex-col gap-3">
          <BottomDock
            label={t('kit.dock.title')}
            tabs={[{ id: 'log', label: t('kit.dock.log') }, { id: 'events', label: t('kit.dock.events'), count: 2 }]}
            active={dockTab} onTab={setDockTab} collapsed={dockCollapsed} onToggle={() => setDockCollapsed((v) => !v)}
            toggleLabel={t('kit.dock.toggle')}
          >
            <p className="font-mono text-[12px]">{t('kit.dock.line1')}</p>
            <p className="font-mono text-[12px]">{t('kit.dock.line2')}</p>
          </BottomDock>
          <BottomDock
            label={t('kit.dock.title')}
            tabs={[{ id: 'events', label: t('kit.dock.events'), count: 2 }]}
            active={dock2Tab} onTab={setDock2Tab} collapsed onToggle={() => {}}
            toggleLabel={t('kit.dock.toggle')}
          >
            <p>{t('kit.dock.line2')}</p>
          </BottomDock>
        </div>
      </Panel>

      <Panel id="conn" title={t('kit.conn.title')}>
        <div className="flex flex-wrap items-center gap-2">
          <ConnPill state="live" stateLabel={t('kit.conn.live')} detailLabel={t('kit.conn.liveDetail')} />
          <ConnPill state="stale" stateLabel={t('kit.conn.stale')} detailLabel={t('kit.conn.staleDetail')} />
          <ConnPill state="offline" stateLabel={t('kit.conn.offline')} detailLabel={t('kit.conn.offlineDetail')} />
        </div>
      </Panel>
    </div>
  );
}
