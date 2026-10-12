import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { fmtAge } from '../../lib/format';
import { SIGNALS, formatSignal, shortName, unitOf } from '../../lib/plant';
import type { TagInfo } from '../../types';
import { EmptyState } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import { QualityMark } from '../../shared/ui/Status';
import { useFaceplate } from '../faceplate/FaceplateContext';

export function TagsPage({ tags }: { tags: TagInfo[] }) {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const { openFaceplate } = useFaceplate();
  useStore(() => live.version);
  const now = useNow(1000);
  const label = (n: string) => (SIGNALS[n] ? t(SIGNALS[n].labelKey) : shortName(n));
  const needle = q.trim().toLowerCase();
  const rows = tags.filter((tag) => !needle
    || tag.name.toLowerCase().includes(needle) || label(tag.name).toLowerCase().includes(needle));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t('tags.title')}</h1>
          <p className="lede">{t('tags.lede')}</p>
        </div>
        <div className="actions">
          <label className="search">
            <Icon name="search" size={18} />
            <span className="sr-only">{t('tags.search')}</span>
            <input
              className="input" type="search" placeholder={t('tags.search')} value={q}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                if (e.target.value) next.set('q', e.target.value); else next.delete('q');
                setParams(next, { replace: true });
              }}
            />
          </label>
        </div>
      </header>
      <section className="panel">
        <div className="panel-body flush" style={{ overflowX: 'auto' }}>
          {rows.length === 0 ? (
            <EmptyState icon="search" title={t('tags.none', { q })} />
          ) : (
            <table className="table tags-table">
              <thead>
                <tr>
                  <th scope="col">{t('tags.colName')}</th>
                  <th scope="col">{t('tags.colPath')}</th>
                  <th scope="col" className="num">{t('tags.colValue')}</th>
                  <th scope="col">{t('tags.colQuality')}</th>
                  <th scope="col">{t('tags.colUpdated')}</th>
                  <th scope="col">{t('tags.colAccess')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((tag) => {
                  const v = live.latest.get(tag.name);
                  const stale = !v || now - (Date.parse(v.ts) || 0) > STALE_MS;
                  const unit = unitOf(tag.name, tag.unit);
                  return (
                    <tr key={tag.name}>
                      <td>
                        <button type="button" className="tag-link" onClick={() => openFaceplate(tag.name)}>
                          {label(tag.name)}
                        </button>
                      </td>
                      <td className="mono dim">{tag.name}</td>
                      <td className="value">
                        {stale && !v ? '—' : formatSignal(tag.name, v?.v, i18n.language)}
                        {v && typeof v.v === 'number' && unit && <span className="dim"> {unit}</span>}
                      </td>
                      <td>{stale ? <QualityMark stale /> : (v?.q === 'good' ? <span className="dim">{t('state.good')}</span> : <QualityMark q={v?.q} />)}</td>
                      <td className="dim">{v ? fmtAge(v.ts, now) : t('state.never')}</td>
                      <td>
                        <span className="badge">{tag.writable ? t('tags.writable') : t('tags.readonly')}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
