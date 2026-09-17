import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AlbumCoverArtImage } from '@/cover/AlbumCoverArtImage';
import { coverServerScopeForServerId } from '@/cover/serverScope';
import type { SubsonicShare, SubsonicShareEntry } from '@/lib/api/subsonicSharing';
import { useRailScroll } from '@/lib/hooks/useRailScroll';
import { shareEntryIsAlbum, shareEntryLabel } from '@/features/share/sharePresentation';

interface ArtworkItem {
  albumId: string;
  coverArt?: string;
  label: string;
  entries: SubsonicShareEntry[];
}

function shareArtworkItems(share: SubsonicShare): ArtworkItem[] {
  const items = new Map<string, ArtworkItem>();
  for (const entry of share.entry ?? []) {
    const id = typeof entry.id === 'string' ? entry.id : '';
    const albumId = shareEntryIsAlbum(entry)
      ? id
      : typeof entry.albumId === 'string' ? entry.albumId : id;
    if (!albumId) continue;
    const existing = items.get(albumId);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }
    const coverArt = typeof entry.coverArt === 'string' ? entry.coverArt : undefined;
    const entryLabel = shareEntryLabel(entry);
    const label = shareEntryIsAlbum(entry) && entryLabel
      ? entryLabel
      : typeof entry.album === 'string' && entry.album.trim()
        ? entry.album.trim()
        : entryLabel ?? albumId;
    items.set(albumId, { albumId, coverArt, label, entries: [entry] });
  }
  return [...items.values()];
}

interface ShareArtworkRailProps {
  serverId: string;
  share: SubsonicShare;
  onOpen: (entries: SubsonicShareEntry[], label: string) => void;
}

export default function ShareArtworkRail({ serverId, share, onOpen }: ShareArtworkRailProps) {
  const { t } = useTranslation();
  const items = shareArtworkItems(share);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { showLeft, showRight, measure, scrollByPage } = useRailScroll({
    scrollRef,
    itemCount: items.length,
    resetKey: `${serverId}:${share.id}`,
  });

  if (items.length === 0) return null;

  return (
    <div className="shared-link__artwork-section">
      <div className="shared-link__artwork-nav album-row-nav">
        <button
          type="button"
          className={`nav-btn ${!showLeft ? 'disabled' : ''}`}
          disabled={!showLeft}
          aria-label={t('shared.previousArtwork')}
          onClick={() => scrollByPage('left')}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`nav-btn ${!showRight ? 'disabled' : ''}`}
          disabled={!showRight}
          aria-label={t('shared.nextArtwork')}
          onClick={() => scrollByPage('right')}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="album-grid-wrapper">
        <div className="shared-link__artwork-rail" ref={scrollRef} onScroll={measure}>
          {items.map(item => (
            <button
              type="button"
              className="shared-link__artwork"
              key={item.albumId}
              aria-label={`${t('shared.contentsTitle')}: ${item.label}`}
              title={item.label}
              onClick={() => onOpen(item.entries, item.label)}
            >
              <AlbumCoverArtImage
                albumId={item.albumId}
                coverArt={item.coverArt}
                serverScope={coverServerScopeForServerId(serverId)}
                displayCssPx={96}
                surface="dense"
                className="shared-link__artwork-image"
                alt=""
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
