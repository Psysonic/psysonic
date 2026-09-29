import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

import { APP_MAIN_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';
import { ndListTagsForServer, type NdTagValue } from '@/lib/api/navidromeBrowse';
import { genreColor } from '@/lib/library/genreColor';
import { useAuthStore } from '@/store/authStore';
import { groupLabels, LABEL_OTHER_BUCKET, RECORD_LABEL_TAG } from '@/features/label/utils/labelDisplay';

const SCROLL_KEY = 'labels-scroll';

type LoadState = 'loading' | 'ready' | 'unavailable';

export default function Labels() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const serverId = useAuthStore(s => s.activeServerId);

  const [tags, setTags] = useState<NdTagValue[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;
    // React Compiler set-state-in-effect rule: loading is reset when the active server changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState('loading');
    ndListTagsForServer(serverId, RECORD_LABEL_TAG)
      .then(rows => {
        if (cancelled) return;
        setTags(rows);
        setState('ready');
      })
      .catch(() => {
        // Not Navidrome, or a Navidrome too old for /api/tag.
        if (cancelled) return;
        setTags([]);
        setState('unavailable');
      });
    return () => { cancelled = true; };
  }, [serverId]);

  const sections = useMemo(() => groupLabels(tags, query), [tags, query]);
  const labelTotal = useMemo(() => sections.reduce((n, s) => n + s.labels.length, 0), [sections]);

  useEffect(() => {
    if (state !== 'ready' || labelTotal === 0) return;
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (!saved) return;
    sessionStorage.removeItem(SCROLL_KEY);
    requestAnimationFrame(() => {
      const el = document.getElementById(APP_MAIN_SCROLL_VIEWPORT_ID);
      if (el) el.scrollTop = parseInt(saved, 10);
    });
  }, [state, labelTotal]);

  const openLabel = (id: string, name: string) => {
    const el = document.getElementById(APP_MAIN_SCROLL_VIEWPORT_ID);
    if (el) sessionStorage.setItem(SCROLL_KEY, String(el.scrollTop));
    const params = new URLSearchParams({ id });
    if (serverId) params.set('server', serverId);
    navigate(`/label/${encodeURIComponent(name)}?${params.toString()}`);
  };

  const jumpTo = (bucket: string) => {
    document.getElementById(`labels-section-${bucket}`)?.scrollIntoView({ block: 'start' });
  };

  const bucketTitle = (bucket: string) => (bucket === LABEL_OTHER_BUCKET ? t('labels.other') : bucket);

  return (
    <div className="content-body animate-fade-in">
      <div className="psy-page-heading psy-page-heading--spaced">
        <h1 className="page-title truncate" title={t('labels.title')}>{t('labels.title')}</h1>
        {state === 'ready' && labelTotal > 0 && (
          <span className="psy-page-heading__count">
            <span aria-hidden="true">–</span>
            {labelTotal} {t('labels.labelCount', { count: labelTotal })}
          </span>
        )}
      </div>

      {state === 'loading' && <p className="loading-text">{t('labels.loading')}</p>}

      {state === 'unavailable' && <p className="loading-text">{t('labels.unavailable')}</p>}

      {state === 'ready' && (
        <>
          <div className="labels-search">
            <Search size={14} className="labels-search-icon" aria-hidden="true" />
            <input
              type="search"
              className="input labels-search-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('labels.filterPlaceholder')}
              aria-label={t('labels.filterPlaceholder')}
            />
          </div>

          {sections.length === 0 ? (
            <p className="loading-text">{t(query.trim() ? 'labels.noMatches' : 'labels.empty')}</p>
          ) : (
            <>
              <nav className="labels-letter-nav" aria-label={t('labels.jumpTo')}>
                {sections.map(s => (
                  <button key={s.bucket} type="button" className="btn btn-ghost" onClick={() => jumpTo(s.bucket)}>
                    {bucketTitle(s.bucket)}
                  </button>
                ))}
              </nav>
              {sections.map(section => (
                <section key={section.bucket} id={`labels-section-${section.bucket}`} className="labels-section">
                  <h2 className="labels-section-title">{bucketTitle(section.bucket)}</h2>
                  <div className="genre-cloud">
                    {section.labels.map(label => (
                      <button
                        key={label.id}
                        type="button"
                        className="genre-pill"
                        style={{ '--genre-color': genreColor(label.name) } as React.CSSProperties}
                        onClick={() => openLabel(label.id, label.name)}
                      >
                        {label.name}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
