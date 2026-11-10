// Line control (console v6, D2): an info banner that says this is not a
// safety system, a toolbar of actions that exist, the selected equipment's
// inspector with its readout, the equipment grid with grouped live value and
// limits, the Commands / Message log / Schematic tabs, and the Log / Events
// dock. Nothing here sends a command except through the audited sheet.

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { getScope } from '../../lib/scope';
import { live } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { LINE_EQUIPMENT as EQUIPMENT, T, type LineEquipmentId } from '../../lib/plant';
import { fmtAge } from '../../lib/format';
import { useControlGate, gateReasonKey } from '../../app/session';
import { PageBar, Card } from '../../shared/ui/Page';
import { ErrorState, PageSkeleton } from '../../shared/ui/Feedback';
import { DdIcon } from '../../shared/ui/DdIcon';
import { InfoBanner, Toolbar, ToolGroup, ToolButton, SectionTag, ConnPill, BottomDock } from '../../shared/ui/ConsoleKit';
import { LineStatusBar } from '../../shared/ui/LineStatusBar';
import { EquipmentPicker } from '../../shared/ui/EquipmentPicker';
import { useAlarms } from '../alarms/alarms';
import { useSceneSource } from '../line3d/useSceneSource';
import { PartPanel } from '../line3d/PartPanel';
import { Mimic, useLimits } from './Mimic';
import { SideView, SideList, SideLegend } from './SideView';
import { Inspector } from './Inspector';
import { EquipmentGrid } from './EquipmentGrid';
import { CommandsTab } from './CommandsTab';
import { MessageLog, LineLog, EventLog } from './MessageLog';
import { buildRows, connOf, matches, type LogLevel } from './lineModel';
import './i18n';

const PRIMARY: Record<string, string> = { motor: T.speedSp, conveyor: T.beltSpeed, camera: T.gravel, bin: T.binLevel };
const KINDS = { motor: 'set', conveyor: 'other', camera: 'other', bin: 'other' } as const;
const LINE_TAGS = EQUIPMENT.flatMap((e) => e.signals);

/** The original ISA-101 side elevation, kept as its own tab. */
function SchematicPanel({ sel, onSelect }: { sel: string | null; onSelect: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="overflow-x-auto p-2" tabIndex={0} role="region" aria-label={t('line.schematic')}>
        <Mimic sel={sel as LineEquipmentId | null} onSelect={onSelect} />
      </div>
      <p className="border-t border-line px-3 py-2 text-[13px] text-ink-46">{t('line.legend')}</p>
    </>
  );
}

/** Side view: the plant's parts as a process-flow elevation. */
function SideViewCard() {
  const { t } = useTranslation();
  const src = useSceneSource();
  const [sel, setSel] = useState<string | null>(null);
  const part = sel !== null ? src.parts[Number(sel)] : undefined;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 min-[1700px]:grid-cols-[minmax(0,1fr)_340px]">
      <Card title={t('side.title')} pad={false} actions={<SideLegend />}>
        {src.status !== 'ready' ? (
          <p className="p-4 text-[13px] text-ink-46" role="status">{t('side.loading')}</p>
        ) : (
          <>
            <div className="relative">
              <SideView parts={src.parts} sel={sel} onSelect={setSel} />
            </div>
            <p className="px-3 pb-1 pt-2 text-[12px] text-ink-46 md:hidden">{t('side.scroll')}</p>
            <p className="border-t border-line px-3 py-2 text-[12px] text-ink-46">{t('side.hint')}</p>
            <div className="border-t border-line p-3 md:hidden"><SideList parts={src.parts} sel={sel} onSelect={setSel} /></div>
          </>
        )}
      </Card>
      <Card title={part ? part.label : t('faceplate.title')}>
        {part ? <PartPanel part={part} kind={src.kinds[part.kind]} /> : <p className="text-[13px] text-ink-46">{t('side.empty')}</p>}
      </Card>
    </div>
  );
}

export function LinePage() {
  const { t } = useTranslation();
  const now = useNow();
  const [sel, setSel] = useState<string>('motor');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'commands' | 'messages' | 'schematic'>('commands');
  const [dockTab, setDockTab] = useState('log');
  const [dockClosed, setDockClosed] = useState(false);
  const [level, setLevel] = useState<LogLevel>('info');
  const [params, setParams] = useSearchParams();
  const side = params.get('view') === 'side';
  const [refreshing, setRefreshing] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const gate = useControlGate();
  useStore(() => live.version);
  useStore(() => live.cmdRev);
  // cold start: a revision counter also moves on reset, so gate on the flags
  const seeded = useStore(() => live.tagsSeeded);
  const seedError = useStore(() => live.seedError);
  const rules = useLimits();
  const { open: openAlarms } = useAlarms();

  if (seedError && !seeded) {
    return <><PageBar title={t('line.title')} /><ErrorState onRetry={() => window.location.reload()} /></>;
  }
  if (!seeded) {
    return <><PageBar title={t('line.title')} /><PageSkeleton /></>;
  }

  const runV = live.latest.get(T.running)?.v;
  const running = runV === true || runV === 1;
  const rows = buildRows({
    equipment: EQUIPMENT,
    primary: PRIMARY,
    now,
    latest: live.latest,
    commands: live.commands.values(),
    rules: [...rules.values()].flat(),
    alarms: openAlarms,
    running,
    kinds: KINDS,
    runTag: T.running,
  });
  const visible = rows.filter((r) => matches([t(r.labelKey), r.tag], search));
  const selected = rows.find((r) => r.id === sel) ?? rows[0];
  const newest = LINE_TAGS.map((tag) => live.latest.get(tag)?.ts).filter(Boolean).sort().pop();
  const conn = connOf(live.ws, newest, now);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await qc.invalidateQueries({ queryKey: ['tags', getScope()?.siteId ?? 'none'] });
      await qc.invalidateQueries({ queryKey: ['alarm-rules'] });
      const cmds = await api.listCommands(20);
      cmds.forEach((c) => live.mergeCommand(c));
    } catch { /* the strip already shows a dead feed */ } finally { setRefreshing(false); }
  };

  const focusCommand = () => {
    setSide(false);
    setSel('motor');
    // the motor's field mounts only after the selection and the view change
    // commit; the router navigation can land a frame later, so retry briefly
    const tryFocus = (left = 20) => {
      const el = document.getElementById('line-setpoint');
      if (el) el.focus();
      else if (left > 0) requestAnimationFrame(() => tryFocus(left - 1));
    };
    requestAnimationFrame(() => tryFocus());
  };
  const setSide = (on: boolean) => setParams(on ? { view: 'side' } : {}, { replace: true });

  return (
    <>
      <PageBar title={t('line.title')} lede={t('line.lede')} actions={<EquipmentPicker />} />
      <div className="flex flex-col gap-3 p-4">
        <InfoBanner>{t('d2.info')}</InfoBanner>
        <LineStatusBar />
        <Toolbar
          label={t('d2.toolbar')}
          trailing={
            <ConnPill
              state={conn.state}
              stateLabel={conn.state === 'offline' ? t('d2.feedDown') : conn.state === 'stale' ? t('d2.notCurrent') : t('shell.live')}
              detailLabel={conn.ageMs == null ? '—' : t(conn.state === 'live' ? 'd2.receiving' : 'd2.lastValue', { age: fmtAge(newest, now) })}
            />
          }
        >
          <ToolGroup label={t('d2.tools')}>
            <ToolButton icon="refresh" label={refreshing ? t('common.loading') : t('d2.refresh')} onClick={() => void refresh()} />
            <ToolButton
              icon="play"
              label={t('d2.command')}
              onClick={focusCommand}
              disabled={!gate.allowed}
              disabledReason={t(gate.reason ? gateReasonKey(gate.reason) : 'control.unavailable')}
            />
            <ToolButton icon="bell" label={t('d2.alarms')} onClick={() => navigate('/alarms')} />
          </ToolGroup>
          <ToolGroup label={t('d2.views')}>
            <ToolButton icon="line" label={t('d2.schematic')} active={!side} onClick={() => setSide(false)} />
            <ToolButton icon="queue" label={t('d2.side')} active={side} onClick={() => setSide(true)} />
          </ToolGroup>
        </Toolbar>

        {side ? <SideViewCard /> : (
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
            <Inspector id={selected.id} row={selected} onSelect={setSel} />

            <div className="flex min-w-0 flex-col gap-3">
              <section className="min-w-0 rounded-[5px] border border-line bg-paper">
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                  <SectionTag>{t('d2.equipment', { n: rows.length })}</SectionTag>
                  <span className="text-[12px] text-ink-46">{t('line.schematic')}</span>
                  <label className="ml-auto flex items-center gap-1.5 text-[12px] text-ink-46">
                    <DdIcon name="search" size={13} />
                    <input
                      className="input h-7 w-44 max-w-full"
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t('d2.filter')}
                      aria-label={t('d2.filter')}
                    />
                  </label>
                </div>
                <EquipmentGrid
                  rows={visible}
                  selectedId={selected.id}
                  onSelect={(r) => setSel(r.id)}
                  onOpen={(r) => { setSel(r.id); document.getElementById('line-inspector')?.focus(); }}
                  emptyLabel={t('d2.filterEmpty')}
                />
              </section>

              <section className="min-w-0 rounded-[5px] border border-line bg-paper">
                <div role="tablist" aria-label={t('d2.commands')} className="flex gap-1 overflow-x-auto border-b border-line px-2">
                  {([['commands', t('d2.commands')], ['messages', t('d2.messageLog')], ['schematic', t('d2.schematic')]] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={tab === id}
                      onClick={() => setTab(id)}
                      className={`h-9 shrink-0 border-b-2 px-3 text-[13px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${
                        tab === id ? 'border-blue font-semibold text-ink' : 'border-transparent text-ink-68 hover:text-blue'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="min-h-36 min-w-0">
                  {tab === 'commands' ? <CommandsTab /> : tab === 'messages' ? <MessageLog /> : <SchematicPanel sel={sel} onSelect={setSel} />}
                </div>
              </section>
            </div>
          </div>
        )}

        <BottomDock
          label={t('d2.log')}
          tabs={[{ id: 'log', label: t('d2.log') }, { id: 'events', label: t('d2.events') }]}
          active={dockTab}
          onTab={setDockTab}
          collapsed={dockClosed}
          onToggle={() => setDockClosed((v) => !v)}
          toggleLabel={t('d2.dockToggle')}
          height={150}
        >
          <div className="mb-1 flex justify-end">
            <label className="flex items-center gap-1.5 text-[13px] text-ink-68">
              {t('d2.level')}
              <select className="input h-7 text-[13px]" value={level} onChange={(e) => setLevel(e.target.value as LogLevel)}>
                <option value="info">{t('d2.levelInfo')}</option>
                <option value="warning">{t('d2.levelWarning')}</option>
                <option value="error">{t('d2.levelError')}</option>
              </select>
            </label>
          </div>
          {dockTab === 'log' ? <LineLog level={level} /> : <EventLog />}
        </BottomDock>
      </div>
    </>
  );
}
