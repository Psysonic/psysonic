import { Fragment, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useHomeStore,
  useSonicSimilarityAvailable,
  type BecauseYouLikeSource,
  type HomeSectionId,
} from '@/features/home';
import { useListReorderDnd } from '@/lib/hooks/useListReorderDnd';
import { applyListReorderById, type ListReorderDropTarget } from '@/lib/util/listReorder';
import { ReorderGripHandle } from '@/features/settings/components/ReorderGripHandle';
import { SettingsSegmented, type SegmentedOption } from '@/features/settings/components/SettingsSegmented';
import { SettingsSubCard, SettingsField } from '@/features/settings/components/SettingsSubCard';

function BecauseYouLikeSourcePicker() {
  const { t } = useTranslation();
  const source = useHomeStore(s => s.becauseYouLikeSource);
  const setSource = useHomeStore(s => s.setBecauseYouLikeSource);
  const audiomuseAvailable = useSonicSimilarityAvailable();
  // Without AudioMuse the rail uses similar artists whatever is stored, so show that.
  const effective: BecauseYouLikeSource = audiomuseAvailable ? source : 'similarArtists';

  const options: SegmentedOption<BecauseYouLikeSource>[] = [
    { id: 'similarArtists', label: t('home.becauseYouLikeSourceSimilarArtists') },
    { id: 'audiomuse', label: t('home.becauseYouLikeSourceAudiomuse'), disabled: !audiomuseAvailable },
  ];
  const note = (
    <>
      {effective === 'audiomuse'
        ? t('home.becauseYouLikeSourceAudiomuseHint')
        : t('home.becauseYouLikeSourceSimilarArtistsHint')}
      {!audiomuseAvailable && (
        <>
          <br />
          {t('home.becauseYouLikeSourceAudiomuseUnavailable')}
        </>
      )}
    </>
  );

  return (
    <SettingsSubCard>
      <SettingsField label={t('home.becauseYouLikeSource')} note={note}>
        <SettingsSegmented
          options={options}
          value={effective}
          onChange={setSource}
          ariaLabel={t('home.becauseYouLikeSource')}
        />
      </SettingsField>
    </SettingsSubCard>
  );
}

const REORDER_TYPE = 'home_section_reorder';

export function HomeCustomizer() {
  const { t } = useTranslation();
  const sections = useHomeStore(s => s.sections);
  const setSections = useHomeStore(s => s.setSections);
  const toggleSection = useHomeStore(s => s.toggleSection);
  const sectionsRef = useRef(sections);
  // React Compiler refs rule: ref kept in sync with the latest value for use in handlers; not render data.
  // eslint-disable-next-line react-hooks/refs
  sectionsRef.current = sections;

  // The store keeps the hero first, so a drop above it lands just below.
  const apply = useCallback((draggedId: string, target: ListReorderDropTarget) => {
    const next = applyListReorderById(sectionsRef.current, draggedId, target);
    if (next) setSections(next);
  }, [setSections]);

  const { isDragging, setContainer, onMouseMove, dropEdge } = useListReorderDnd({ type: REORDER_TYPE, apply });

  const SECTION_LABELS: Record<HomeSectionId, string> = {
    hero:            t('home.hero'),
    continueListening: t('resume.title'),
    recent:          t('sidebar.newReleases'),
    discover:        t('home.discover'),
    becauseYouLike:  t('home.becauseYouLike'),
    discoverSongs:   t('home.discoverSongs'),
    discoverArtists: t('home.discoverArtists'),
    recentlyPlayed:  t('home.recentlyPlayed'),
    starred:         t('home.starred'),
    mostPlayed:      t('home.mostPlayed'),
    losslessAlbums:  t('home.losslessAlbums'),
  };

  return (
    <div style={{ padding: '4px 0' }} ref={setContainer} onMouseMove={onMouseMove}>
      {sections.map(sec => {
        const label = SECTION_LABELS[sec.id];
        // The hero sits above the rails and keeps its place.
        const movable = sec.id !== 'hero';
        const edge = isDragging && movable ? dropEdge(sec.id) : null;
        return (
          <Fragment key={sec.id}>
            <div
              data-reorder-id={movable ? sec.id : undefined}
              className="sidebar-customizer-row"
              style={{
                borderTop:    edge === 'before' ? '2px solid var(--accent)' : undefined,
                borderBottom: edge === 'after'  ? '2px solid var(--accent)' : undefined,
              }}
            >
              {movable
                ? <ReorderGripHandle id={sec.id} type={REORDER_TYPE} label={label} />
                : <span aria-hidden="true" style={{ width: 16, flexShrink: 0 }} />}
              <span style={{ flex: 1, fontSize: 14, opacity: sec.visible ? 1 : 0.45 }}>{label}</span>
              <label className="toggle-switch" aria-label={label}>
                <input type="checkbox" checked={sec.visible} onChange={() => toggleSection(sec.id)} />
                <span className="toggle-track" />
              </label>
            </div>
            {sec.id === 'becauseYouLike' && sec.visible && <BecauseYouLikeSourcePicker />}
          </Fragment>
        );
      })}
    </div>
  );
}
