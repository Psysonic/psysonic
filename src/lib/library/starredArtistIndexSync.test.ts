import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStarredForServer: vi.fn(),
  libraryReconcileArtistStars: vi.fn(),
}));

vi.mock('@/lib/api/subsonicStarRating', () => ({
  getStarredForServer: mocks.getStarredForServer,
}));

vi.mock('@/lib/api/library', () => ({
  libraryReconcileArtistStars: mocks.libraryReconcileArtistStars,
}));

import { refreshStarredArtistIndexForServer } from './starredArtistIndexSync';

describe('refreshStarredArtistIndexForServer', () => {
  beforeEach(() => {
    mocks.getStarredForServer.mockReset();
    mocks.libraryReconcileArtistStars.mockReset().mockResolvedValue(undefined);
  });

  it('reconciles the explicit server without creating ownership ambiguity', async () => {
    mocks.getStarredForServer.mockResolvedValue({
      artists: [{ id: 'ar-1', name: 'Artist', starred: '2024-01-02T03:04:05.000Z' }],
      albums: [],
      songs: [],
    });

    await expect(refreshStarredArtistIndexForServer('srv-2')).resolves.toEqual([
      expect.objectContaining({ id: 'ar-1', serverId: 'srv-2', starred: '2024-01-02T03:04:05.000Z' }),
    ]);
    expect(mocks.libraryReconcileArtistStars).toHaveBeenCalledWith({
      serverId: 'srv-2',
      starredArtists: [{ id: 'ar-1', starredAt: Date.parse('2024-01-02T03:04:05.000Z') }],
    });
  });
});
