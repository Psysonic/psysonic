import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { SETTINGS_SEARCH_SECTIONS } from '@/generated/settingsSearchIndex';
import { searchSettings } from '@/features/settings/components/settingsSearch';

const tEn = i18n.getFixedT('en');
const tDe = i18n.getFixedT('de');

describe('settings search index', () => {
  it.each([
    'Navidrome',
    'settings.coverSourceSectionTitle',
    'settings.externalArtwork',
    'settings.fullscreenPlayerStyle',
    'settings.trackPreviewsTitle',
    'settings.inputMouseTitle',
    'settings.lyricsWordHighlightTitle',
    'settings.lyricsPronunciationTitle',
    'settings.lyricsTranslationTitle',
    'settings.themeImportTitle',
  ])('contains the %s section', heading => {
    expect(SETTINGS_SEARCH_SECTIONS.some(s => s.titleKey === heading || s.title === heading)).toBe(true);
  });

  it('records the rows inside a section', () => {
    const navidrome = SETTINGS_SEARCH_SECTIONS.find(s => s.title === 'Navidrome');
    expect(navidrome?.keys).toEqual(expect.arrayContaining([
      'settings.playQueueSyncTitle', 'shared.navidromeSharingTitle', 'shared.allowDownloadsTitle',
    ]));
  });
});

describe('searchSettings', () => {
  it('finds AudioMuse by product name', () => {
    const hits = searchSettings('AudioMuse', 'library', tEn);
    expect(hits.some(h => h.title.includes('AudioMuse'))).toBe(true);
  });

  it('finds global volume shortcuts', () => {
    const hits = searchSettings('Volume', 'library', tEn);
    expect(hits.some(h => h.key === 'global:volume-up')).toBe(true);
    expect(hits.some(h => h.key === 'global:volume-down')).toBe(true);
  });

  it('finds per-address streaming quality by bitrate keywords', () => {
    const hits = searchSettings('bitrate', 'library', tEn);
    expect(hits).toContainEqual(expect.objectContaining({ tab: 'servers', key: 'settings.streamQualityTitle' }));
  });

  it.each(['visualizer', 'spectrum', 'oscilloscope'])('finds the visualizer section by %s', query => {
    const hits = searchSettings(query, 'library', tEn);
    expect(hits).toContainEqual(expect.objectContaining({ tab: 'appearance', key: 'visualizer.settings.section' }));
  });

  it.each(['Navidrome', 'sharing', 'downloads', 'play queue sync'])('finds the Navidrome section by %s', query => {
    const hits = searchSettings(query, 'library', tEn);
    expect(hits).toContainEqual(expect.objectContaining({ tab: 'integrations', title: 'Navidrome' }));
  });

  it('names the row that matched', () => {
    const hit = searchSettings('sharing', 'library', tEn).find(h => h.title === 'Navidrome');
    expect(hit?.context).toBe('Navidrome sharing');
    expect(hit?.focusTitle).toBe('Navidrome');
  });

  it('tolerates typos', () => {
    const hits = searchSettings('navidrom shareing', 'library', tEn);
    expect(hits[0]).toEqual(expect.objectContaining({ title: 'Navidrome', context: 'Navidrome sharing' }));
  });

  it('does not stretch a word that exists to a similar one', () => {
    const hits = searchSettings('tray', 'library', tEn);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some(h => /track/i.test(h.title))).toBe(false);
  });

  it('tells in-app and global shortcuts apart', () => {
    const hits = searchSettings('volume up', 'library', tEn).filter(h => h.title === 'Volume up');
    expect(hits.map(h => h.context).sort()).toEqual(['Global Shortcuts', 'Keyboard shortcuts'].sort());
  });

  it('searches the UI language and English', () => {
    const german = searchSettings('Freigaben', 'library', tDe, { tEn });
    expect(german).toContainEqual(expect.objectContaining({ title: 'Navidrome', context: 'Navidrome-Freigaben' }));
    const english = searchSettings('sharing', 'library', tDe, { tEn });
    expect(english).toContainEqual(expect.objectContaining({ title: 'Navidrome', context: 'Navidrome-Freigaben' }));
  });

  it('hides Advanced Mode sections while it is off', () => {
    const on = searchSettings('artist page layout', 'library', tEn, { advancedEnabled: true });
    const off = searchSettings('artist page layout', 'library', tEn, { advancedEnabled: false });
    expect(on.some(h => h.key === 'settings.artistLayoutTitle')).toBe(true);
    expect(off.some(h => h.key === 'settings.artistLayoutTitle')).toBe(false);
  });

  it('hides the Users tab when it is not available', () => {
    const hits = searchSettings('user management', 'library', tEn, { usersAvailable: false });
    expect(hits.some(h => h.tab === 'users')).toBe(false);
    expect(searchSettings('user management', 'library', tEn).some(h => h.tab === 'users')).toBe(true);
  });

  it('returns nothing for nonsense queries', () => {
    expect(searchSettings('aaaaaaa', 'library', tEn)).toEqual([]);
    expect(searchSettings('qxzvbnm', 'library', tEn)).toEqual([]);
  });
});
