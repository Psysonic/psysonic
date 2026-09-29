import { search, searchForServer } from '@/lib/api/subsonicSearch';
import { ndListAlbumsByTagForServer, ndListTagsForServer } from '@/lib/api/navidromeBrowse';
import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import AlbumCard from '@/features/album/components/AlbumCard';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/authStore';
import { usePerfProbeFlags } from '@/lib/perf/perfFlags';
import { albumGridWarmCovers } from '@/cover/layoutSizes';
import { VirtualCardGrid } from '@/ui/VirtualCardGrid';
import { readDetailServerId } from '@/lib/navigation/detailServerScope';
import { RECORD_LABEL_TAG, cleanLabelName } from '@/features/label';

const TAG_PAGE_SIZE = 200;
/** Upper bound on albums fetched for one label; the largest real labels stay well below it. */
const TAG_MAX_ALBUMS = 2000;

/** Tag id for a label name, matched case-insensitively after cleanup. */
async function resolveLabelTagId(serverId: string, name: string): Promise<string | null> {
  const wanted = cleanLabelName(name).toLocaleLowerCase();
  const rows = await ndListTagsForServer(serverId, RECORD_LABEL_TAG, name);
  return rows.find(r => cleanLabelName(r.value).toLocaleLowerCase() === wanted)?.id ?? null;
}

/** Every album carrying the label tag, via Navidrome's native tag filter. */
async function loadAlbumsByLabelTag(serverId: string, tagId: string): Promise<SubsonicAlbum[]> {
  const albums: SubsonicAlbum[] = [];
  for (let start = 0; start < TAG_MAX_ALBUMS; start += TAG_PAGE_SIZE) {
    const page = await ndListAlbumsByTagForServer(serverId, RECORD_LABEL_TAG, tagId, start, start + TAG_PAGE_SIZE);
    albums.push(...page.albums);
    const reachedTotal = page.total !== null && albums.length >= page.total;
    if (page.albums.length < TAG_PAGE_SIZE || reachedTotal) break;
  }
  return albums;
}

/** Best-effort fallback for servers without the native tag API: a search on the name. */
async function loadAlbumsBySearch(serverId: string | null, name: string): Promise<SubsonicAlbum[]> {
  const options = { albumCount: 200, artistCount: 0, songCount: 0 };
  const res = serverId ? await searchForServer(serverId, name, options) : await search(name, options);
  // Filter out albums that don't match the record label exactly if possible,
  // to avoid unrelated search hits. We do case-insensitive comparison.
  const matches = res.albums.filter(a => a.recordLabel?.toLowerCase() === name.toLowerCase());
  // Fallback: if Navidrome's search doesn't return the exact label in the recordLabel field
  // (or it's not indexed exactly as typed), just show all album matches
  // as a decent best-effort if our strict filter yields nothing.
  return matches.length > 0 ? matches : res.albums;
}

export default function LabelAlbums() {
  const { t } = useTranslation();
  const perfFlags = usePerfProbeFlags();
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [albums, setAlbums] = useState<SubsonicAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const musicLibraryFilterVersion = useAuthStore(s => s.musicLibraryFilterVersion);
  const activeServerId = useAuthStore(s => s.activeServerId);
  const ownerServerId = readDetailServerId(searchParams, activeServerId);
  const invalidExplicitServer = searchParams.has('server') && !ownerServerId;
  const tagIdParam = searchParams.get('id');

  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    // React Compiler set-state-in-effect rule: state set from an async result resolved in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    if (invalidExplicitServer) {
      setAlbums([]);
      setLoading(false);
      return;
    }

    const load = async (): Promise<SubsonicAlbum[]> => {
      if (ownerServerId) {
        try {
          const tagId = tagIdParam ?? await resolveLabelTagId(ownerServerId, name);
          if (tagId) return await loadAlbumsByLabelTag(ownerServerId, tagId);
        } catch {
          // Not Navidrome, or too old for the tag API — fall through to search.
        }
      }
      return loadAlbumsBySearch(ownerServerId, name);
    };

    load()
      .then(result => { if (!cancelled) setAlbums(result); })
      .catch(error => { if (!cancelled) console.error(error); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [invalidExplicitServer, name, musicLibraryFilterVersion, ownerServerId, tagIdParam]);

  return (
    <div className="animate-fade-in" style={{ padding: '0 var(--space-6)' }}>
      <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ margin: '1rem 0', gap: '6px' }}>
        <ChevronLeft size={16} /> {t('common.back')}
      </button>

      <h1 className="page-title" style={{ marginBottom: '2rem' }}>
        Label: <span style={{ color: 'var(--accent)' }}>{name}</span>
        {!loading && albums.length > 0 && (
          <span className="psy-page-heading__count" style={{ marginLeft: '0.75rem' }}>
            {t('labels.albumCount', { count: albums.length })}
          </span>
        )}
      </h1>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
          <div className="spinner" />
        </div>
      ) : albums.length === 0 ? (
        <div className="empty-state">{t('common.noAlbums')}</div>
      ) : (
        <VirtualCardGrid
          items={albums}
          itemKey={a => `${a.serverId ?? ownerServerId ?? ''}\u0000${a.id}`}
          rowVariant="album"
          disableVirtualization={perfFlags.disableMainstageVirtualLists}
          layoutSignal={albums.length}
          warmGridCovers={albumGridWarmCovers()}
          renderItem={a => <AlbumCard album={a} />}
        />
      )}
    </div>
  );
}
