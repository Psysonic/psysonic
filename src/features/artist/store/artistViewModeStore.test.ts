import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ARTIST_VIEW_MODE,
  useArtistViewModeStore,
} from './artistViewModeStore';

const STORAGE_KEY = 'psysonic_artist_view_mode';

function seedPersisted(viewMode: unknown): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ state: { viewMode }, version: 1 }),
  );
}

describe('useArtistViewModeStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useArtistViewModeStore.setState({ viewMode: DEFAULT_ARTIST_VIEW_MODE });
  });

  it('persists the selected view mode', () => {
    useArtistViewModeStore.getState().setViewMode('list');

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
      state?: { viewMode?: unknown };
    };
    expect(persisted.state?.viewMode).toBe('list');
  });

  it('rehydrates the stored view mode', async () => {
    seedPersisted('list');
    await useArtistViewModeStore.persist.rehydrate();

    expect(useArtistViewModeStore.getState().viewMode).toBe('list');
  });

  it('falls back to grid for a damaged persisted mode', async () => {
    seedPersisted('table');

    await useArtistViewModeStore.persist.rehydrate();

    expect(useArtistViewModeStore.getState().viewMode).toBe('grid');
    expect(typeof useArtistViewModeStore.getState().setViewMode).toBe('function');
  });
});
