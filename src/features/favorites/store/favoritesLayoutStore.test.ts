import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_FAVORITES_SECTIONS,
  useFavoritesLayoutStore,
} from './favoritesLayoutStore';

const STORAGE_KEY = 'psysonic_favorites_layout';

function seedPersisted(sections: unknown): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { sections }, version: 0 }));
}

function ids(): string[] {
  return useFavoritesLayoutStore.getState().sections.map(s => s.id);
}

describe('useFavoritesLayoutStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useFavoritesLayoutStore.setState({ sections: DEFAULT_FAVORITES_SECTIONS });
  });

  it('starts in the historical page order with every section shown', () => {
    expect(ids()).toEqual(['artists', 'albums', 'stations', 'topArtists', 'songs']);
    expect(useFavoritesLayoutStore.getState().sections.every(s => s.visible)).toBe(true);
  });

  it('hides and shows a single section and persists it', () => {
    useFavoritesLayoutStore.getState().toggleSection('topArtists');

    const top = useFavoritesLayoutStore.getState().sections.find(s => s.id === 'topArtists');
    expect(top?.visible).toBe(false);
    expect(useFavoritesLayoutStore.getState().sections.filter(s => !s.visible)).toHaveLength(1);
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
      state?: { sections?: { id: string; visible: boolean }[] };
    };
    expect(persisted.state?.sections?.find(s => s.id === 'topArtists')?.visible).toBe(false);

    useFavoritesLayoutStore.getState().toggleSection('topArtists');
    expect(useFavoritesLayoutStore.getState().sections.find(s => s.id === 'topArtists')?.visible).toBe(true);
  });

  it('reset restores the default order and visibility', () => {
    useFavoritesLayoutStore.getState().setSections([
      { id: 'songs', visible: false },
      { id: 'artists', visible: true },
      { id: 'albums', visible: true },
      { id: 'stations', visible: true },
      { id: 'topArtists', visible: false },
    ]);

    useFavoritesLayoutStore.getState().reset();

    expect(useFavoritesLayoutStore.getState().sections).toEqual(DEFAULT_FAVORITES_SECTIONS);
  });

  it('rehydrates a stored order', async () => {
    seedPersisted([
      { id: 'songs', visible: true },
      { id: 'topArtists', visible: false },
      { id: 'artists', visible: true },
      { id: 'albums', visible: true },
      { id: 'stations', visible: true },
    ]);

    await useFavoritesLayoutStore.persist.rehydrate();

    expect(ids()).toEqual(['songs', 'topArtists', 'artists', 'albums', 'stations']);
    expect(useFavoritesLayoutStore.getState().sections[1].visible).toBe(false);
  });

  it('drops unknown, broken and duplicate entries and appends sections the store did not know yet', async () => {
    seedPersisted([
      { id: 'songs', visible: false },
      null,
      { id: 'playlists', visible: true },
      { visible: true },
      { id: 'songs', visible: true },
      { id: 'albums', visible: true },
    ]);

    await useFavoritesLayoutStore.persist.rehydrate();

    expect(ids()).toEqual(['songs', 'albums', 'artists', 'stations', 'topArtists']);
    // The first stored entry wins; the duplicate must not flip it back on.
    expect(useFavoritesLayoutStore.getState().sections[0]).toEqual({ id: 'songs', visible: false });
  });
});
