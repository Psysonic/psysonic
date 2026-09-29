import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useHomeStore,
  useSonicSimilarityAvailable,
  type BecauseYouLikeSource,
  type HomeSectionId,
} from '@/features/home';
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

export function HomeCustomizer() {
  const { t } = useTranslation();
  const { sections, toggleSection } = useHomeStore();

  const SECTION_LABELS: Record<HomeSectionId, string> = {
    hero:            t('home.hero'),
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
    <div style={{ padding: '4px 0' }}>
      {sections.map(sec => (
        <Fragment key={sec.id}>
          <div className="sidebar-customizer-row">
            <span style={{ flex: 1, fontSize: 14 }}>{SECTION_LABELS[sec.id]}</span>
            <label className="toggle-switch" aria-label={SECTION_LABELS[sec.id]}>
              <input type="checkbox" checked={sec.visible} onChange={() => toggleSection(sec.id)} />
              <span className="toggle-track" />
            </label>
          </div>
          {sec.id === 'becauseYouLike' && sec.visible && <BecauseYouLikeSourcePicker />}
        </Fragment>
      ))}
    </div>
  );
}
