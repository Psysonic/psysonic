import { useTranslation } from 'react-i18next';
import { AudioLines, Languages, Music2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import SettingsSubSection from '@/features/settings/components/SettingsSubSection';
import { SettingsGroup } from '@/features/settings/components/SettingsGroup';
import { LyricsSourcesCustomizer } from '@/features/settings/components/LyricsSourcesCustomizer';
import { SettingsSegmented, type SegmentedOption } from '@/features/settings/components/SettingsSegmented';
import { SettingsSubCard, SettingsField } from '@/features/settings/components/SettingsSubCard';
import { SettingsToggle } from '@/features/settings/components/SettingsToggle';

export function LyricsTab() {
  const { t } = useTranslation();
  const sidebarLyricsStyle = useAuthStore(s => s.sidebarLyricsStyle);
  const setSidebarLyricsStyle = useAuthStore(s => s.setSidebarLyricsStyle);
  const lyricsRomanizationEnabled = useAuthStore(s => s.lyricsRomanizationEnabled);
  const setLyricsRomanizationEnabled = useAuthStore(s => s.setLyricsRomanizationEnabled);
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
  const wordHighlightOptions: SegmentedOption<'step' | 'smooth'>[] = [
    { id: 'step', label: t('settings.lyricsWordHighlightStep') },
    { id: 'smooth', label: t('settings.lyricsWordHighlightSmooth') },
  ];
  const wordHighlightDescKey = wordHighlightMode === 'step'
    ? 'settings.lyricsWordHighlightStepDesc'
    : 'settings.lyricsWordHighlightSmoothDesc';

  return (
    <>
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
        searchText={`${t('settings.lyricsWordHighlightTitle')} ${t('settings.lyricsWordHighlightStep')} ${t('settings.lyricsWordHighlightSmooth')} ${t(wordHighlightDescKey)}`}
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
        searchText={`${t('settings.lyricsPronunciationTitle')} ${t('settings.lyricsRomanization')} ${t('settings.lyricsRomanizationDesc')}`}
      >
        <SettingsGroup>
          <SettingsToggle
            label={t('settings.lyricsRomanization')}
            checked={lyricsRomanizationEnabled}
            onChange={setLyricsRomanizationEnabled}
          />
        </SettingsGroup>
      </SettingsSubSection>
    </>
  );
}
