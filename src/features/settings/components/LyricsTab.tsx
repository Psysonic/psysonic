import { useTranslation } from 'react-i18next';
import { useId } from 'react';
import { AudioLines, Globe, Languages, Music2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import type { LyricsWordHighlightMode } from '@/store/authStoreTypes';
import SettingsSubSection from '@/features/settings/components/SettingsSubSection';
import { SettingsGroup } from '@/features/settings/components/SettingsGroup';
import { LyricsSourcesCustomizer } from '@/features/settings/components/LyricsSourcesCustomizer';
import { SettingsSegmented, type SegmentedOption } from '@/features/settings/components/SettingsSegmented';
import { SettingsSubCard, SettingsField, SettingsRow, SettingsValue } from '@/features/settings/components/SettingsSubCard';
import { SettingsToggle } from '@/features/settings/components/SettingsToggle';
import { LYRICS_SCALE_DEFAULT, LYRICS_SCALE_MIN, LYRICS_SCALE_MAX, LYRICS_SCALE_STEP } from '@/lib/media/lyricsAppearance';

export function LyricsTab() {
  const { t } = useTranslation();
  const sizeId = useId();
  const lyricsScale = useAuthStore(s => s.lyricsScale);
  const setLyricsScale = useAuthStore(s => s.setLyricsScale);
  const showSizeIndicator = useAuthStore(s => s.lyricsSizeIndicatorEnabled);
  const setSizeIndicator = useAuthStore(s => s.setLyricsSizeIndicatorEnabled);
  const romanizationPrimary = useAuthStore(s => s.lyricsRomanizationPrimary);
  const setRomanizationPrimary = useAuthStore(s => s.setLyricsRomanizationPrimary);
  const sidebarLyricsStyle = useAuthStore(s => s.sidebarLyricsStyle);
  const setSidebarLyricsStyle = useAuthStore(s => s.setSidebarLyricsStyle);
  const lyricsRomanizationEnabled = useAuthStore(s => s.lyricsRomanizationEnabled);
  const setLyricsRomanizationEnabled = useAuthStore(s => s.setLyricsRomanizationEnabled);
  const lyricsTranslationEnabled = useAuthStore(s => s.lyricsTranslationEnabled);
  const setLyricsTranslationEnabled = useAuthStore(s => s.setLyricsTranslationEnabled);
  const wordHighlightMode = useAuthStore(s => s.lyricsWordHighlightMode);
  const setWordHighlightMode = useAuthStore(s => s.setLyricsWordHighlightMode);

  const lyricsStyleOptions: SegmentedOption<'classic' | 'apple'>[] = [
    { id: 'classic', label: t('settings.sidebarLyricsStyleClassic') },
    { id: 'apple', label: t('settings.sidebarLyricsStyleApple') },
  ];
  const lyricsStyleDescKey =
    sidebarLyricsStyle === 'classic'
      ? 'settings.sidebarLyricsStyleClassicDesc'
      : 'settings.sidebarLyricsStyleAppleDesc';
  const wordHighlightOptions: SegmentedOption<LyricsWordHighlightMode>[] = [
    { id: 'step', label: t('settings.lyricsWordHighlightStep') },
    { id: 'smooth', label: t('settings.lyricsWordHighlightSmooth') },
    { id: 'flowing', label: t('settings.lyricsWordHighlightFlowing') },
  ];
  const wordHighlightDescKey = wordHighlightMode === 'step'
    ? 'settings.lyricsWordHighlightStepDesc'
    : wordHighlightMode === 'smooth'
      ? 'settings.lyricsWordHighlightSmoothDesc'
      : 'settings.lyricsWordHighlightFlowingDesc';

  return (
    <>
      <SettingsSubSection title={t('settings.lyricsSize')} icon={<AudioLines size={16} />}>
        <SettingsGroup>
          <SettingsSubCard>
            <SettingsField label={<label htmlFor={sizeId}>{t('settings.lyricsSize')}</label>}>
              <p id={`${sizeId}-hint`} className="settings-norm-help">{t('settings.lyricsSizeDesc')} {t('settings.lyricsZoomKeyboardHint')}</p>
              <SettingsRow>
                <input
                  id={sizeId}
                  type="range"
                  min={LYRICS_SCALE_MIN * 100}
                  max={LYRICS_SCALE_MAX * 100}
                  step={LYRICS_SCALE_STEP * 100}
                  value={Math.round(lyricsScale * 100)}
                  aria-valuetext={`${Math.round(lyricsScale * 100)}%`}
                  aria-describedby={`${sizeId}-hint`}
                  onChange={event => setLyricsScale(Number(event.target.value) / 100)}
                />
                <SettingsValue>{Math.round(lyricsScale * 100)}%</SettingsValue>
                <button type="button" className="btn btn-ghost" onClick={() => setLyricsScale(LYRICS_SCALE_DEFAULT)}>
                  {t('settings.lyricsSizeReset')}
                </button>
              </SettingsRow>
            </SettingsField>
            <SettingsToggle label={t('settings.lyricsSizeIndicator')} checked={showSizeIndicator} onChange={setSizeIndicator} />
          </SettingsSubCard>
        </SettingsGroup>
      </SettingsSubSection>

      <SettingsSubSection
        title={t('settings.lyricsSourcesTitle')}
        icon={<Music2 size={16} />}
        description={t('settings.lyricsSourcesDesc')}
      >
        <SettingsGroup>
          <LyricsSourcesCustomizer />
        </SettingsGroup>
      </SettingsSubSection>

      <SettingsSubSection
        title={t('settings.lyricsWordHighlightTitle')}
        icon={<AudioLines size={16} />}
      >
        <SettingsGroup>
          <SettingsSegmented
            options={wordHighlightOptions}
            value={wordHighlightMode}
            onChange={setWordHighlightMode}
            ariaLabel={t('settings.lyricsWordHighlightTitle')}
          />
          <SettingsSubCard style={{ marginTop: '0.85rem' }}>
            <SettingsField desc={t(wordHighlightDescKey)} />
          </SettingsSubCard>
        </SettingsGroup>
      </SettingsSubSection>

      <SettingsSubSection
        title={t('settings.sidebarLyricsStyle')}
        icon={<AudioLines size={16} />}
      >
        <SettingsGroup>
          <SettingsSegmented
            options={lyricsStyleOptions}
            value={sidebarLyricsStyle}
            onChange={setSidebarLyricsStyle}
            ariaLabel={t('settings.sidebarLyricsStyle')}
          />
          <SettingsSubCard style={{ marginTop: '0.85rem' }}>
            <SettingsField desc={t(lyricsStyleDescKey)} />
          </SettingsSubCard>
        </SettingsGroup>
      </SettingsSubSection>

      <SettingsSubSection
        title={t('settings.lyricsPronunciationTitle')}
        icon={<Languages size={16} />}
        description={t('settings.lyricsRomanizationDesc')}
      >
        <SettingsGroup>
          <SettingsToggle
            label={t('settings.lyricsRomanization')}
            checked={lyricsRomanizationEnabled}
            onChange={setLyricsRomanizationEnabled}
          />
          <SettingsToggle
            label={t('settings.lyricsRomanizationPrimary')}
            desc={t('settings.lyricsRomanizationPrimaryDesc')}
            checked={romanizationPrimary}
            onChange={setRomanizationPrimary}
          />
        </SettingsGroup>
      </SettingsSubSection>

      <SettingsSubSection
        title={t('settings.lyricsTranslationTitle')}
        icon={<Globe size={16} />}
        description={t('settings.lyricsTranslationDesc')}
      >
        <SettingsGroup>
          <SettingsToggle
            label={t('settings.lyricsTranslation')}
            checked={lyricsTranslationEnabled}
            onChange={setLyricsTranslationEnabled}
          />
        </SettingsGroup>
      </SettingsSubSection>
    </>
  );
}
