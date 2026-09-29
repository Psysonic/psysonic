import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFavoritesLayoutStore, type FavoritesSectionConfig, type FavoritesSectionId } from '@/features/favorites';
import { useListReorderDnd } from '@/lib/hooks/useListReorderDnd';
import { applyListReorderById, type ListReorderDropTarget } from '@/lib/util/listReorder';
import { ReorderGripHandle } from '@/features/settings/components/ReorderGripHandle';

// The section headings the Favorites page itself shows, so the list here reads
// exactly like the page it arranges.
const FAVORITES_SECTION_LABEL_KEYS: Record<FavoritesSectionId, string> = {
  artists:    'favorites.artists',
  albums:     'favorites.albums',
  stations:   'favorites.stations',
  topArtists: 'favorites.topArtists',
  songs:      'favorites.songs',
};

const REORDER_TYPE = 'favorites_section_reorder';

export function FavoritesLayoutCustomizer() {
  const { t } = useTranslation();
  const sections = useFavoritesLayoutStore(s => s.sections);
  const setSections = useFavoritesLayoutStore(s => s.setSections);
  const toggleSection = useFavoritesLayoutStore(s => s.toggleSection);
  const sectionsRef = useRef(sections);
  // React Compiler refs rule: ref kept in sync with the latest value for use in handlers; not render data.
  // eslint-disable-next-line react-hooks/refs
  sectionsRef.current = sections;

  const apply = useCallback((draggedId: string, target: ListReorderDropTarget) => {
    const next = applyListReorderById(sectionsRef.current, draggedId, target);
    if (next) setSections(next);
  }, [setSections]);

  const { isDragging, setContainer, onMouseMove, dropEdge } = useListReorderDnd({ type: REORDER_TYPE, apply });

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
        {t('settings.favoritesLayoutDesc')}
      </p>
      <div style={{ padding: '4px 0' }} ref={setContainer} onMouseMove={onMouseMove}>
        {sections.map((section: FavoritesSectionConfig) => {
          const label = t(FAVORITES_SECTION_LABEL_KEYS[section.id]);
          const edge = isDragging ? dropEdge(section.id) : null;
          return (
            <div
              key={section.id}
              data-reorder-id={section.id}
              className="sidebar-customizer-row"
              style={{
                borderTop:    edge === 'before' ? '2px solid var(--accent)' : undefined,
                borderBottom: edge === 'after'  ? '2px solid var(--accent)' : undefined,
              }}
            >
              <ReorderGripHandle id={section.id} type={REORDER_TYPE} label={label} />
              <span style={{ flex: 1, fontSize: 14, opacity: section.visible ? 1 : 0.45 }}>{label}</span>
              <label className="toggle-switch" aria-label={label}>
                <input type="checkbox" checked={section.visible} onChange={() => toggleSection(section.id)} />
                <span className="toggle-track" />
              </label>
            </div>
          );
        })}
      </div>
    </>
  );
}
