import { beforeEach, describe, expect, it } from 'vitest';
import {
  cleanSettings,
  DEFAULT_SETTINGS,
  useBurnSettingsStore,
} from '@/features/burner/store/burnSettingsStore';

beforeEach(() => {
  useBurnSettingsStore.getState().reset();
});

describe('burn settings', () => {
  it('starts on the defaults', () => {
    expect(useBurnSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);
  });

  it('changes one option and leaves the rest alone', () => {
    useBurnSettingsStore.getState().patch({ testWrite: true });
    useBurnSettingsStore.getState().patch({ writeSpeed: 1764 });

    const { settings } = useBurnSettingsStore.getState();
    expect(settings.testWrite).toBe(true);
    expect(settings.writeSpeed).toBe(1764);
    expect(settings.cdText).toBe(DEFAULT_SETTINGS.cdText);
    expect(settings.gapless).toBe(DEFAULT_SETTINGS.gapless);
  });

  it('keeps a rehearsal a rehearsal, which is why these are remembered at all', () => {
    // Leaving the page and coming back used to reset this to false, turning the
    // next press of the button into a real burn on a disc that cannot be undone.
    useBurnSettingsStore.getState().patch({ testWrite: true });
    expect(useBurnSettingsStore.getState().settings.testWrite).toBe(true);
  });
});

describe('cleanSettings', () => {
  it('takes stored settings as they are', () => {
    const stored = { ...DEFAULT_SETTINGS, testWrite: true, writeSpeed: 882, cdText: false };
    expect(cleanSettings(stored)).toEqual(stored);
  });

  it('falls back to the defaults for anything missing or the wrong type', () => {
    expect(cleanSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings({ gapless: 'yes', cdText: 1 })).toEqual(DEFAULT_SETTINGS);
  });

  it('refuses a write speed that is not a speed', () => {
    // A burn asks the drive for this figure; a nonsense one must not reach it.
    for (const writeSpeed of ['4x', 0, -1, Number.NaN, Number.POSITIVE_INFINITY, null]) {
      expect(cleanSettings({ writeSpeed }).writeSpeed, String(writeSpeed)).toBeNull();
    }
    expect(cleanSettings({ writeSpeed: 1764 }).writeSpeed).toBe(1764);
  });
});
