import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

import { APP_MAIN_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';
import { libraryGetLabelAlbumCounts } from '@/lib/api/library';
import { genreColor } from '@/lib/library/genreColor';
import { deriveLibraryBrowseIndexScopes } from '@/lib/library/libraryBrowseScope';
import { useAuthStore } from '@/store/authStore';
import { useLibrarySyncRevision } from '@/store/offlineLocalLibrarySyncRevision';
import {
  groupLabels,
  LABEL_OTHER_BUCKET,
  mergeLabelCatalogs,
  type LabelEntry,
} from '@/features/label/utils/labelDisplay';

const SCROLL_KEY = 'labels-scroll';

export default function Labels() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const musicLibraryFilterVersion = useAuthStore(s => s.musicLibraryFilterVersion);
  const libraryBrowseScopeVersion = useAuthStore(s => s.libraryBrowseScopeVersion);
  const librarySyncRevision = useLibrarySyncRevision();

  const [labels, setLabels] = useState<LabelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    // Every server and library in the browse scope, read from the local label index.
    const scopes = deriveLibraryBrowseIndexScopes(useAuthStore.getState());
    // React Compiler set-state-in-effect rule: loading is reset when the library scope or index revision changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    void Promise.allSettled(
      scopes.map(scope =>
        libraryGetLabelAlbumCounts({
          serverId: scope.serverId,
          libraryScopes: scope.libraryIds.length > 0 ? scope.libraryIds : undefined,
        }),
      ),
    )
      .then(results => {
        if (cancelled) return;
        const catalogs = results.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []));
        setLabels(mergeLabelCatalogs(catalogs));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [musicLibraryFilterVersion, libraryBrowseScopeVersion, librarySyncRevision]);

  const sections = useMemo(() => groupLabels(labels, query), [labels, query]);
  const labelTotal = useMemo(() => sections.reduce((n, s) => n + s.labels.length, 0), [sections]);

  useEffect(() => {
    if (loading || labelTotal === 0) return;
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (!saved) return;
    sessionStorage.removeItem(SCROLL_KEY);
    requestAnimationFrame(() => {
      const el = document.getElementById(APP_MAIN_SCROLL_VIEWPORT_ID);
      if (el) el.scrollTop = parseInt(saved, 10);
    });
  }, [loading, labelTotal]);

  const openLabel = (name: string) => {
    const el = document.getElementById(APP_MAIN_SCROLL_VIEWPORT_ID);
    if (el) sessionStorage.setItem(SCROLL_KEY, String(el.scrollTop));
    navigate(`/label/${encodeURIComponent(name)}`, { state: { returnTo: '/labels' } });
  };

  const jumpTo = (bucket: string) => {
    document.getElementById(`labels-section-${bucket}`)?.scrollIntoView({ block: 'start' });
  };

  const bucketTitle = (bucket: string) => (bucket === LABEL_OTHER_BUCKET ? t('labels.other') : bucket);

  return (
    <div className="content-body animate-fade-in">
      <div className="psy-page-heading psy-page-heading--spaced">
        <h1 className="page-title truncate" title={t('labels.title')}>{t('labels.title')}</h1>
        {!loading && labelTotal > 0 && (
          <span className="psy-page-heading__count">
            <span aria-hidden="true">–</span>
            {labelTotal} {t('labels.labelCount', { count: labelTotal })}
          </span>
        )}
      </div>

      {loading && <p className="loading-text">{t('labels.loading')}</p>}

      {!loading && labels.length === 0 && <p className="loading-text">{t('labels.empty')}</p>}

      {!loading && labels.length > 0 && (
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
            <p className="loading-text">{t('labels.noMatches')}</p>
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
                        key={label.name}
                        type="button"
                        className="genre-pill"
                        style={{ '--genre-color': genreColor(label.name) } as React.CSSProperties}
                        onClick={() => openLabel(label.name)}
                        data-tooltip={t('labels.albumCount', { count: label.albumCount })}
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
