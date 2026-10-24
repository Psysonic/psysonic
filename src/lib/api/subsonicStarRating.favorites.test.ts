import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onInvoke } from '@/test/mocks/tauri';
import { useLibraryIndexStore } from '@/store/libraryIndexStore';
import { notifyFavoritesChanged } from '@/lib/library/favoritesRevision';
import { star, unstar } from './subsonicStarRating';

vi.mock('@/lib/api/subsonicClient', () => ({
  api: vi.fn(async () => ({})),
  apiForServer: vi.fn(async () => ({})),
  libraryFilterParams: () => ({}),
  libraryFilterParamsForServer: () => ({}),
}));
vi.mock('@/lib/library/favoritesRevision', () => ({ notifyFavoritesChanged: vi.fn() }));
vi.mock('@/features/offline', () => ({ onFavoritesOfflineStarChange: vi.fn() }));

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('star / unstar → favorites refresh', () => {
  beforeEach(() => {
    vi.mocked(notifyFavoritesChanged).mockClear();
    useLibraryIndexStore.setState({ masterEnabled: true });
  });

  it.each([
    ['star', star],
    ['unstar', unstar],
  ] as const)('%s tells favorites only once the local index has the change', async (_name, toggle) => {
    let landPatch!: () => void;
    onInvoke('library_patch_track', () => new Promise<void>(resolve => {
      landPatch = resolve;
    }));

    await toggle('t1', 'song', { serverId: 's1' });
    await settle();
    expect(notifyFavoritesChanged).not.toHaveBeenCalled();

    landPatch();
    await settle();
    expect(notifyFavoritesChanged).toHaveBeenCalledTimes(1);
  });

  it('tells favorites straight away when the index is off', async () => {
    useLibraryIndexStore.setState({ masterEnabled: false });

    await star('t1', 'song', { serverId: 's1' });
    await settle();
    expect(notifyFavoritesChanged).toHaveBeenCalledTimes(1);
  });
});
