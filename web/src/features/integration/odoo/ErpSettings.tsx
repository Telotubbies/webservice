// ERP connection settings (the secret is write-only) and id-map editing, F18/F19.
// Backend: backend/app/integration/routes.py (/connections, /id-map).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../../lib/api';
import { Notice } from '../../../shared/ui/Feedback';
import './i18n';

interface Conn { id: string; kind: string; name: string; config: Record<string, string>; has_secret: boolean; enabled: boolean; status: string }
interface MapRow { connection_id: string; entity: string; external_id: string; local_id: string; external_ver: string | null; inactive: boolean }
const ENTITIES = ['product', 'work_order', 'work_center', 'reason'] as const;
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const EMPTY_MAP = { connection_id: '', entity: 'product' as (typeof ENTITIES)[number], external_id: '', local_id: '', external_ver: '' };

export function ErpSettings({ orgId, admin }: { orgId: string; admin: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const base = `/api/v1/orgs/${encodeURIComponent(orgId)}/integration`;
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [c, setC] = useState({ name: '', url: '', db: '', login: '', secret: '' });
  const [m, setM] = useState(EMPTY_MAP);
  const conns = useQuery({ queryKey: ['erp-conns', orgId], queryFn: () => request<{ items: Conn[] }>(`${base}/connections`) });
  const rows = useQuery({ queryKey: ['erp-idmap', orgId], queryFn: () => request<{ items: MapRow[] }>(`${base}/id-map`) });
  const fail = (e: unknown) => setMsg({ tone: 'error', text: t('erp.errGeneric', { reason: e instanceof Error ? e.message : String(e) }) });
  const create = useMutation({
    mutationFn: () => request(`${base}/connections`, json('POST', { kind: 'odoo', name: c.name.trim(), config: { url: c.url.trim(), db: c.db.trim(), login: c.login.trim() }, secret: c.secret })),
    onSuccess: () => { setC({ name: '', url: '', db: '', login: '', secret: '' }); setMsg({ tone: 'ok', text: t('erp.connSaved') }); void qc.invalidateQueries({ queryKey: ['erp-conns', orgId] }); }, onError: fail,
  });
  const put = useMutation({
    mutationFn: () => request(`${base}/id-map`, json('PUT', { ...m, external_ver: m.external_ver.trim() || null })),
    onSuccess: () => { setM(EMPTY_MAP); setMsg({ tone: 'ok', text: t('erp.mapSaved') }); void qc.invalidateQueries({ queryKey: ['erp-idmap', orgId] }); }, onError: fail,
  });
  const cOk = c.name.trim() && /^https?:\/\//.test(c.url.trim()) && c.db.trim() && c.login.trim() && c.secret;
  const mOk = m.connection_id && m.external_id.trim() && m.local_id.trim();
  const field = (id: string, label: string, v: string, set: (s: string) => void, extra: object = {}) => (
    <div><label className="field-label" htmlFor={id}>{label}</label>
      <input id={id} className="input h-8 w-44" value={v} disabled={!admin} onChange={(e) => set(e.target.value)} {...extra} /></div>);
  const connName = (id: string) => conns.data?.items.find((x) => x.id === id)?.name ?? id.slice(0, 8);
  return (
    <>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <section className="space-y-2" aria-label={t('erp.connTitle')}>
        <h2 className="text-[13px] font-medium">{t('erp.connTitle')}</h2>
        <ul className="space-y-1 text-[13px]">{(conns.data?.items ?? []).map((x) => (
          <li key={x.id}>{x.name} · {x.kind}{x.config?.url ? ` · ${x.config.url}` : ''} · {x.has_secret ? t('erp.secretSet') : t('erp.secretNone')}</li>))}</ul>
        {admin ? (
          <form className="flex flex-wrap items-end gap-3 text-[13px]" onSubmit={(e) => { e.preventDefault(); if (cOk) create.mutate(); }}>
            {field('erp-name', t('erp.connName'), c.name, (s) => setC({ ...c, name: s }), { maxLength: 120 })}
            {field('erp-url', t('erp.odooUrl'), c.url, (s) => setC({ ...c, url: s }), { type: 'url', placeholder: 'https://' })}
            {field('erp-db', t('erp.odooDb'), c.db, (s) => setC({ ...c, db: s }))}
            {field('erp-login', t('erp.odooUser'), c.login, (s) => setC({ ...c, login: s }), { autoComplete: 'off' })}
            {field('erp-secret', t('erp.secret'), c.secret, (s) => setC({ ...c, secret: s }), { type: 'password', autoComplete: 'new-password', maxLength: 500 })}
            <button type="submit" className="btn btn-sm" disabled={!cOk || create.isPending}>{t('erp.connSave')}</button>
          </form>) : <p className="text-[12px] text-ink-68">{t('erp.needAdmin')}</p>}
        <p className="text-[12px] text-ink-68">{t('erp.secretHelp')}</p>
      </section>
      <section className="space-y-2" aria-label={t('erp.mapTitle')}>
        <h2 className="text-[13px] font-medium">{t('erp.mapTitle')}</h2>
        {admin && (
          <form className="flex flex-wrap items-end gap-3 text-[13px]" onSubmit={(e) => { e.preventDefault(); if (mOk) put.mutate(); }}>
            <div><label className="field-label" htmlFor="map-conn">{t('erp.mapConn')}</label>
              <select id="map-conn" className="input h-8" value={m.connection_id} onChange={(e) => setM({ ...m, connection_id: e.target.value })}>
                <option value="">{t('erp.pickConn')}</option>
                {(conns.data?.items ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
            <div><label className="field-label" htmlFor="map-ent">{t('erp.entity')}</label>
              <select id="map-ent" className="input h-8" value={m.entity} onChange={(e) => setM({ ...m, entity: e.target.value as typeof m.entity })}>
                {ENTITIES.map((x) => <option key={x} value={x}>{t(`erp.e_${x}`)}</option>)}</select></div>
            {field('map-ext', t('erp.extId'), m.external_id, (s) => setM({ ...m, external_id: s }), { maxLength: 200 })}
            {field('map-loc', t('erp.localId'), m.local_id, (s) => setM({ ...m, local_id: s }))}
            {field('map-ver', t('erp.extVer'), m.external_ver, (s) => setM({ ...m, external_ver: s }), { maxLength: 200 })}
            <button type="submit" className="btn btn-sm" disabled={!mOk || put.isPending}>{t('erp.mapSave')}</button>
          </form>)}
        {rows.data?.items.length ? (
          <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
            <thead><tr>{['mapConn', 'entity', 'extId', 'localId', 'extVer'].map((k) => <th key={k} scope="col" className="px-2 py-1 text-[11px] font-semibold text-ink-68">{t(`erp.${k}`)}</th>)}<th /></tr></thead>
            <tbody>{rows.data.items.map((r) => (
              <tr key={`${r.connection_id}${r.entity}${r.external_id}`} className="border-t border-line">
                <td className="px-2 py-1">{connName(r.connection_id)}</td><td className="px-2 py-1">{t(`erp.e_${r.entity}`)}</td>
                <td className="px-2 py-1 font-mono text-[12px]">{r.external_id}</td><td className="px-2 py-1 font-mono text-[12px]">{r.local_id.slice(0, 8)}</td>
                <td className="px-2 py-1">{r.external_ver ?? '—'}</td>
                <td className="px-2 py-1">{admin && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setM({ connection_id: r.connection_id, entity: r.entity as typeof m.entity, external_id: r.external_id, local_id: r.local_id, external_ver: r.external_ver ?? '' })}>{t('erp.edit')}</button>}</td>
              </tr>))}</tbody></table></div>
        ) : <p className="text-[13px] text-ink-68">{t('erp.noMap')}</p>}
      </section>
    </>
  );
}
