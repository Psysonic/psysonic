import { useTranslation } from 'react-i18next';
import { Radio, Heart, ChevronRight, ListMusic, Star } from 'lucide-react';
import { star, unstar } from '@/lib/api/subsonicStarRating';
import type { SubsonicArtist } from '@/lib/api/subsonicTypes';
import StarRating from '@/ui/StarRating';
import { ArtistToPlaylistSubmenu } from '@/features/contextMenu/components/AlbumArtistToPlaylistSubmenu';
import { MultiArtistToPlaylistSubmenu } from '@/features/contextMenu/components/MultiArtistToPlaylistSubmenu';
import type { ContextMenuItemsProps } from '@/features/contextMenu/components/contextMenuItemTypes';
import { ownedEntityKey, ownedOverrideValue } from '@/lib/util/ownedEntityKey';
import { ContextShareMenuItem } from '@/features/share';

export default function ArtistContextItems(props: ContextMenuItemsProps) {
  const {
    type, item, shareKindOverride, closeContextMenu,
    setStarredOverride, userRatingOverrides, setKeyboardRating, keyboardRating,
    activeSubmenuId, setActiveSubmenuId, cancelPlaylistSubmenuCloseTimer, onPlaylistSubmenuTriggerMouseLeave,
    entityRatingSupport, applyArtistRating,
    handleAction, startRadio, isStarred,
    offlinePolicy,
  } = props;
  const { t } = useTranslation();

  return (
    <>
        {type === 'artist' && (() => {
          const artist = item as SubsonicArtist;
          const isComposer = shareKindOverride === 'composer';
          const artistRatingDisabled = entityRatingSupport === 'track_only';
          return (
            <>
              {!isComposer && <div className="context-menu-item" onClick={() => handleAction(() => startRadio(
                artist.id,
                artist.name,
                undefined,
                artist.serverId,
              ))}>
                <Radio size={14} /> {t('contextMenu.startRadio')}
              </div>}
              {!isComposer && offlinePolicy.canAddToPlaylist && (
                <div
                  className={`context-menu-item context-menu-item--submenu ${activeSubmenuId === `artist:${artist.id}` ? 'active' : ''}`}
                  data-submenu-id={`artist:${artist.id}`}
                  onMouseEnter={() => { cancelPlaylistSubmenuCloseTimer(); setActiveSubmenuId(`artist:${artist.id}`); }}
                  onMouseLeave={onPlaylistSubmenuTriggerMouseLeave}
                >
                  <ListMusic size={14} /> {t('contextMenu.addToPlaylist')}
                  <ChevronRight size={13} style={{ marginLeft: 'auto' }} />
                  {activeSubmenuId === `artist:${artist.id}` && (
                    <ArtistToPlaylistSubmenu artistId={artist.id} serverId={artist.serverId} triggerId={`artist:${artist.id}`} onDone={() => { setActiveSubmenuId(null); closeContextMenu(); }} />
                  )}
                </div>
              )}
              <ContextShareMenuItem
                request={{
                  kind: shareKindOverride ?? 'artist',
                  resourceIds: [artist.id],
                  serverIds: artist.serverId ? [artist.serverId] : [],
                }}
                triggerId={`share:${shareKindOverride ?? 'artist'}:${artist.id}`}
                label={t('contextMenu.shareLink')}
                activeSubmenuId={activeSubmenuId}
                setActiveSubmenuId={setActiveSubmenuId}
                cancelSubmenuCloseTimer={cancelPlaylistSubmenuCloseTimer}
                onSubmenuTriggerMouseLeave={onPlaylistSubmenuTriggerMouseLeave}
                onDone={closeContextMenu}
              />
              {(offlinePolicy.canFavorite || offlinePolicy.canRate) && (
                <>
                  <div className="context-menu-divider" />
                  {offlinePolicy.canFavorite && (
                    <div className="context-menu-item" onClick={() => handleAction(() => {
                      const starred = isStarred(artist.id, artist.starred, artist.serverId);
                      setStarredOverride(ownedEntityKey(artist), !starred);
                      const meta = {
                        serverId: artist.serverId,
                        name: artist.name,
                        albumCount: artist.albumCount,
                      };
                      return starred
                        ? unstar(artist.id, 'artist', meta)
                        : star(artist.id, 'artist', meta);
                    })}>
                      <Heart size={14} fill={isStarred(artist.id, artist.starred, artist.serverId) ? 'currentColor' : 'none'} />
                      {isStarred(artist.id, artist.starred, artist.serverId) ? t('contextMenu.unfavoriteArtist') : t('contextMenu.favoriteArtist')}
                    </div>
                  )}
                  {offlinePolicy.canRate && (
                    <div
                      className="context-menu-rating-row"
                      data-rating-kind="artist"
                      data-rating-id={artist.id}
                      data-rating-disabled={artistRatingDisabled ? 'true' : 'false'}
                      onClick={e => e.stopPropagation()}
                    >
                      <Star size={14} className="context-menu-rating-icon" aria-hidden />
                      <StarRating
                        value={keyboardRating?.kind === 'artist' && keyboardRating.id === artist.id
                          ? keyboardRating.value
                          : ownedOverrideValue(userRatingOverrides, artist) ?? artist.userRating ?? 0}
                        disabled={artistRatingDisabled}
                        labelKey="entityRating.artistAriaLabel"
                        onChange={r => { setKeyboardRating({ kind: 'artist', id: artist.id, value: r }); applyArtistRating(artist, r); }}
                      />
                    </div>
                  )}
                </>
              )}
            </>
          );
        })()}

        {type === 'multi-artist' && (() => {
          const artists = item as SubsonicArtist[];
          const artistIds = artists.map(a => a.id);
          const artistServerIds = new Set(artists.map(a => a.serverId).filter(Boolean));
          const artistRatingDisabled = entityRatingSupport === 'track_only';
          const multiArtistRatingId = [...artistIds].sort().join('\x1e');
          const unifiedArtistRating = (() => {
            if (artists.length === 0) return 0;
            const vals = artists.map(a => ownedOverrideValue(userRatingOverrides, a) ?? a.userRating ?? 0);
            const first = vals[0];
            return vals.every(v => v === first) ? first : 0;
          })();
          return (
            <>
              <div className="context-menu-header" style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
                {t('contextMenu.selectedArtists', { count: artists.length })}
              </div>
              <div className="context-menu-divider" />
              {offlinePolicy.canAddToPlaylist && artistServerIds.size <= 1 && (
                <div
                  className={`context-menu-item context-menu-item--submenu ${activeSubmenuId === `multi-artist:${artistIds.join(',')}` ? 'active' : ''}`}
                  data-submenu-id={`multi-artist:${artistIds.join(',')}`}
                  onMouseEnter={() => { cancelPlaylistSubmenuCloseTimer(); setActiveSubmenuId(`multi-artist:${artistIds.join(',')}`); }}
                  onMouseLeave={onPlaylistSubmenuTriggerMouseLeave}
                >
                  <ListMusic size={14} /> {t('contextMenu.addToPlaylist')}
                  <ChevronRight size={13} style={{ marginLeft: 'auto' }} />
                  {activeSubmenuId === `multi-artist:${artistIds.join(',')}` && (
                    <MultiArtistToPlaylistSubmenu artists={artists} triggerId={`multi-artist:${artistIds.join(',')}`} onDone={() => { setActiveSubmenuId(null); closeContextMenu(); }} />
                  )}
                </div>
              )}
              {offlinePolicy.canRate && (
                <div
                  className="context-menu-rating-row"
                  data-rating-kind="artist"
                  data-rating-id={multiArtistRatingId}
                  data-rating-disabled={artistRatingDisabled ? 'true' : 'false'}
                  onClick={e => e.stopPropagation()}
                >
                  <Star size={14} className="context-menu-rating-icon" aria-hidden />
                  <StarRating
                    value={
                      keyboardRating?.kind === 'artist' && keyboardRating.id === multiArtistRatingId
                        ? keyboardRating.value
                        : unifiedArtistRating
                    }
                    disabled={artistRatingDisabled}
                    ariaLabel={t('entityRating.selectedArtistsRatingAriaLabel', { count: artists.length })}
                    onChange={r => {
                      setKeyboardRating({ kind: 'artist', id: multiArtistRatingId, value: r });
                      for (const a of artists) applyArtistRating(a, r);
                    }}
                  />
                </div>
              )}
            </>
          );
        })()}

    </>
  );
}
