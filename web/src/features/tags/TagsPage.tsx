// Tags — the signal list: a full-width omnibar, a left preset panel (all /
// pinned / writable / stale, plus signal-prefix groups), a dense table with
// pin star + sparkline, and a detail flyout that slides in from the right.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { SIGNALS, formatSignal, unitOf } from '../../lib/plant';
import { fmtAge } from '../../lib/format';
import { QualityMark } from '../../shared/ui/Status';
import { Sparkline } from '../../shared/ui/Sparkline';
import { PageBar, Card, Table } from '../../shared/ui/Page';
import { EmptyState } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import { isPinned, togglePin } from '../../lib/watchlist';
import { useEquipment } from '../../lib/equipment';
import { EquipmentPicker } from '../../shared/ui/EquipmentPicker';
import { canAdmin, useAdminOrg, useAdminSite } from '../admin/admin';
import { MoveTags } from '../assets/MoveTags';

/** Detail flyout for the selected tag — name with copy button, current
 *  value + unit, quality/age/access, and the sparkline. */
function TagFlyout({ tag, onClose }: { tag: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  useStore(() => live.version);
  const [copiedTag, setCopiedTag] = useState<string | null>(null);
  const copied = copiedTag === tag;
  const ti = live.tags.find((x) => x.name === tag);
  const tv = live.latest.get(tag);
  const stale = !tv || now - Date.parse(tv.ts) > STALE_MS;
  return (
    <aside className="fixed bottom-0 right-0 top-9 z-20 w-[400px] border-l border-line bg-white shadow-flyout" role="dialog" aria-label={tag}>
      <div className="flex h-11 items-center gap-2 border-b border-line px-4">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold">{tag}</span>
        <button
          type="button"
          className="grid h-6 w-6 place-items-center rounded text-ink-46 hover:bg-subtle hover:text-ink focus-visible:bg-subtle focus-visible:outline-none"
          onClick={() => void navigator.clipboard.writeText(tag).then(() => setCopiedTag(tag))}
          aria-label={t('tags.copyTagNamed', { name: tag })}
          title={copied ? t('tags.copied') : t('tags.copyTag')}
        >
          <Icon name={copied ? 'check' : 'copy'} size={13} />
        </button>
        <button type="button" className="grid h-6 w-6 place-items-center rounded text-ink-46 hover:bg-subtle hover:text-ink focus-visible:bg-subtle focus-visible:outline-none" onClick={onClose} aria-label={t('common.close')}><Icon name="x" size={13} /></button>
      </div>
      <div className="space-y-4 p-4">
        {SIGNALS[tag] && <p className="text-[13px] text-ink-68">{t(SIGNALS[tag].labelKey)}</p>}
        <div>
          <p className="text-[11px] font-semibold uppercase text-ink-46">{t('tags.colValue')}</p>
          <p className="font-mono text-[22px] font-semibold">
            {tv ? formatSignal(tag, tv.v, i18n.language) : '—'}
            {unitOf(tag, ti?.unit) && <span className="ml-1 text-[12px] font-normal text-ink-46">{unitOf(tag, ti?.unit)}</span>}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
          <dt className="text-ink-46">{t('tags.colQuality')}</dt><dd><QualityMark q={tv?.q} stale={stale} /></dd>
          <dt className="text-ink-46">{t('tags.colUpdated')}</dt><dd className="font-mono">{tv ? fmtAge(tv.ts, now) : '—'}</dd>
          <dt className="text-ink-46">{t('tags.colAccess')}</dt><dd>{ti?.writable ? t('tags.writable') : t('tags.readonly')}</dd>
        </dl>
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase text-ink-46">{t('faceplate.trend')}</p>
          <div className="rounded-dd border border-line p-2"><Sparkline tag={tag} /></div>
        </div>
      </div>
    </aside>
  );
}

export function TagsPage() {
  const { t, i18n } = useTranslation();
  const now = useNow();
  useStore(() => live.version);
  const [params] = useSearchParams();
  const [q, setQ] = useState(() => params.get('q') ?? '');
  const [group, setGroup] = useState<string | null>(null);
  const [preset, setPreset] = useState<'all' | 'pinned' | 'writable' | 'stale'>('all');
  const [selTag, setSelTag] = useState<string | null>(null);
  const [, forcePin] = useState(0);
  const { current: eq } = useEquipment();
  const { orgId, orgRole } = useAdminOrg();
  const { site } = useAdminSite(orgId);
  const canMove = canAdmin(orgRole ?? '') && !!orgId && !!site;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const [movedMsg, setMovedMsg] = useState<number | null>(null);
  const togglePick = (n: string) => setPicked((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; });

  // Esc closes the flyout — page-level, since the drawer has no focus trap.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelTag(null); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const tagRev = useStore(() => live.tagRev);
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const ti of live.tags) {
      const g = ti.name.split('.').slice(-2, -1)[0] ?? ti.name.split('.')[0];
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tagRev]);

  const tags = live.tags
    .filter((ti) => {
      if (eq && !eq.tags.includes(ti.name)) return false;
      if (group && !ti.name.includes(`.${group}.`)) return false;
      if (preset === 'pinned' && !isPinned(ti.name)) return false;
      if (preset === 'writable' && !ti.writable) return false;
      if (preset === 'stale') {
        const tv = live.latest.get(ti.name);
        if (tv && now - Date.parse(tv.ts) <= STALE_MS) return false;
      }
      return !q || ti.name.toLowerCase().includes(q.toLowerCase());
    })
    .sort((a, b) => Number(isPinned(b.name)) - Number(isPinned(a.name)) || a.name.localeCompare(b.name));

  const presetRow = (id: typeof preset, label: string) => (
    <button
      key={id}
      type="button"
      aria-pressed={preset === id && !group}
      onClick={() => { setPreset(id); setGroup(null); }}
      className={`flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[13px] focus-visible:bg-subtle focus-visible:outline-none ${
        preset === id && !group ? 'bg-info-soft font-semibold text-blue' : 'text-ink-68 hover:bg-subtle'
      }`}
    >
      <span className="w-3 text-center text-[11px] opacity-60" aria-hidden>★</span> {label}
    </button>
  );

  return (
    <>
      <PageBar title={t('nav.tags')} lede={t('tags.showing', { shown: tags.length, total: live.tags.length })} actions={<EquipmentPicker />} />
      {canMove && (picked.size > 0 || movedMsg != null) && (
        <div className="flex items-center gap-3 border-b border-line bg-info-soft px-4 py-1.5 text-[12px]" role="status">
          {picked.size > 0 ? (
            <>
              <span>{t('asset.moveTagsTitle', { count: picked.size })}</span>
              <button type="button" className="btn btn-sm" onClick={() => setMoving(true)}>{t('asset.moveTags')}</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPicked(new Set())}>{t('asset.cancel')}</button>
            </>
          ) : <span>{t('asset.moveTagsDone', { count: movedMsg ?? 0 })}</span>}
        </div>
      )}
      {/* omnibar row — full width */}
      <div className="border-b border-line bg-white px-4 py-2">
        <div className="relative">
          <Icon name="search" size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" />
          <input
            className="input w-full pl-7"
            placeholder={t('tags.searchHint')}
            aria-label={t('tags.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="flex p-4">
        {/* left preset panel — presets first, then prefix groups with counts */}
        <aside className="w-48 shrink-0 pr-3">
          <div className="relative mb-2">
            <Icon name="search" size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" />
            <input
              className="input h-7 w-full pl-6 text-[12px]"
              placeholder={t('tags.facets')}
              aria-label={t('tags.facets')}
              value={group ?? ''}
              onChange={(e) => setGroup(e.target.value || null)}
            />
          </div>
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase text-ink-46">{t('tags.facets')}</p>
          {presetRow('all', t('feed.all'))}
          {presetRow('pinned', t('watch.facet'))}
          {presetRow('writable', t('tags.writable'))}
          {presetRow('stale', t('state.stale'))}
          <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase text-ink-46">{t('tags.groups')}</p>
          {groups.map(([g, n]) => (
            <button
              key={g}
              type="button"
              aria-pressed={group === g}
              onClick={() => { setGroup(group === g ? null : g); setPreset('all'); }}
              className={`flex h-7 w-full items-center gap-2 rounded px-2 text-left font-mono text-[12px] focus-visible:bg-subtle focus-visible:outline-none ${
                group === g ? 'bg-info-soft font-semibold text-blue' : 'text-ink-68 hover:bg-subtle'
              }`}
            >
              {g}
              <span className="ml-auto rounded-full bg-line px-1.5 text-[10px] font-semibold text-ink-68">{n}</span>
            </button>
          ))}
        </aside>

        <div className="min-w-0 flex-1">
          <Card pad={false}>
            {tags.length === 0 ? (
              live.tags.length === 0 ? (
                <EmptyState title={t('tags.emptyTitle')} body={t('tags.emptyBody')} icon="tags" />
              ) : (
                <EmptyState title={t('tags.noMatchFiltered')} icon="search" />
              )
            ) : (
            <Table head={[...(canMove ? [<input key="all" type="checkbox" aria-label={t('asset.selectAll')} checked={tags.length > 0 && tags.every((x) => picked.has(x.name))}
              onChange={(e) => setPicked(e.target.checked ? new Set(tags.map((x) => x.name)) : new Set())} />] : []), '', t('control.tag'), t('tags.colValue'), t('tags.colQuality'), t('tags.colUpdated'), t('faceplate.trend')]}>
              {tags.map((ti) => {
                const tv = live.latest.get(ti.name);
                const stale = !tv || now - Date.parse(tv.ts) > STALE_MS;
                return (
                  <tr
                    key={ti.name}
                    className={`cursor-pointer focus-visible:bg-info-soft focus-visible:outline-none ${stale ? 'opacity-50' : ''} ${selTag === ti.name ? 'bg-info-soft' : ''}`}
                    tabIndex={0}
                    onClick={() => setSelTag(ti.name)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelTag(ti.name); } }}
                  >
                    {canMove && (
                      <td className="w-8" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={picked.has(ti.name)} onChange={() => togglePick(ti.name)} aria-label={t('asset.selectTag', { name: ti.name })} />
                      </td>
                    )}
                    <td className="w-8">
                      <button
                        type="button"
                        className={`text-[13px] ${isPinned(ti.name) ? 'text-warn' : 'text-ink-35 hover:text-ink'}`}
                        onClick={(e) => { e.stopPropagation(); togglePin(ti.name); forcePin((n) => n + 1); }}
                        onKeyDown={(e) => e.stopPropagation()}
                        aria-label={t(isPinned(ti.name) ? 'watch.unpin' : 'watch.pin')}
                      >★</button>
                    </td>
                    <td>
                      <span className="font-mono text-[12px]">{ti.name}</span>
                      {SIGNALS[ti.name] && <span className="ml-2 text-[11px] text-ink-46">{t(SIGNALS[ti.name].labelKey)}</span>}
                      {ti.writable && <span className="ml-2 rounded border border-line px-1 text-[9px] font-semibold uppercase text-ink-46" title={t('tags.writable')}>W</span>}
                    </td>
                    <td className="font-mono text-[13px] font-semibold">
                      {tv ? formatSignal(ti.name, tv.v, i18n.language) : '—'}
                      {unitOf(ti.name, ti.unit) && <span className="ml-1 font-sans text-[11px] font-normal text-ink-46">{unitOf(ti.name, ti.unit)}</span>}
                    </td>
                    <td><QualityMark q={tv?.q} stale={stale} /></td>
                    <td className="text-[12px] text-ink-68">{tv ? fmtAge(tv.ts, now) : '—'}</td>
                    <td className="w-40"><Sparkline tag={ti.name} /></td>
                  </tr>
                );
              })}
            </Table>
            )}
          </Card>
          <p className="mt-2 text-[11px] text-ink-46">{t('tags.showing', { shown: tags.length, total: live.tags.length })}</p>
        </div>
      </div>

      {/* right flyout — 400px drawer pinned under the topbar */}
      {selTag && <TagFlyout tag={selTag} onClose={() => setSelTag(null)} />}
      {moving && orgId && site && (
        <MoveTags orgId={orgId} siteId={site.id} names={[...picked]} onClose={() => setMoving(false)}
          onDone={(n) => { setMoving(false); setPicked(new Set()); setMovedMsg(n); }} />
      )}
    </>
  );
}
