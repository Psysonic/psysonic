import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type React from 'react';
import {
  runArtistEntityRating,
  runArtistImageUpload,
} from '@/features/artist/utils/runArtistDetailActions';
import { uploadArtistImageForServer } from '@/lib/api/subsonicArtists';
import { invalidateCoverArt } from '@/cover';
import { setRating } from '@/lib/api/subsonicStarRating';
import { useAuthStore } from '@/store/authStore';
import { resetAuthStore } from '@/test/helpers/storeReset';

vi.mock('@/lib/api/subsonicArtists', () => ({
  uploadArtistImageForServer: vi.fn(async () => undefined),
}));
vi.mock('@/cover', () => ({
  invalidateCoverArt: vi.fn(async () => undefined),
}));
vi.mock('@/lib/api/subsonicStarRating', () => ({
  setRating: vi.fn(async () => undefined),
  star: vi.fn(async () => undefined),
  unstar: vi.fn(async () => undefined),
}));
vi.mock('@/lib/dom/toast', () => ({ showToast: vi.fn() }));

const t = ((key: string) => key) as TFunction;

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthStore();
});

describe('artist detail explicit-server actions', () => {
  it('downgrades rating support on the artist owner after a rejected write', async () => {
    vi.mocked(setRating).mockRejectedValueOnce(new Error('unsupported'));
    useAuthStore.setState({
      entityRatingSupportByServer: { 'srv-active': 'full', 'srv-owner': 'full' },
    });

    await runArtistEntityRating({
      artist: { id: 'artist-1', name: 'Artist', serverId: 'srv-owner', userRating: 2 },
      id: 'artist-1',
      rating: 4,
      artistEntityRatingSupport: 'full',
      serverId: 'srv-owner',
      t,
      setArtistEntityRating: vi.fn(),
      setArtist: vi.fn(),
    });

    expect(setRating).toHaveBeenCalledWith('artist-1', 4, {
      serverId: 'srv-owner',
      kind: 'artist',
    });
    expect(useAuthStore.getState().entityRatingSupportByServer).toEqual({
      'srv-active': 'full',
      'srv-owner': 'track_only',
    });
  });

  it('uploads and invalidates against the resolved detail server', async () => {
    const input = document.createElement('input');
    const file = new File(['image'], 'artist.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    const setUploading = vi.fn();
    const setCoverRevision = vi.fn();

    await runArtistImageUpload({
      e: { target: input } as React.ChangeEvent<HTMLInputElement>,
      artist: { id: 'artist-1', name: 'Artist', coverArt: 'cover-1' },
      serverId: 'srv-detail',
      t,
      setUploading,
      setCoverRevision,
    });

    expect(uploadArtistImageForServer).toHaveBeenCalledWith('srv-detail', 'artist-1', file);
    expect(invalidateCoverArt).toHaveBeenNthCalledWith(1, 'cover-1', 'srv-detail');
    expect(invalidateCoverArt).toHaveBeenNthCalledWith(2, 'artist-1', 'srv-detail');
    expect(setUploading).toHaveBeenNthCalledWith(1, true);
    expect(setUploading).toHaveBeenLastCalledWith(false);
    expect(setCoverRevision).toHaveBeenCalledOnce();
  });
});
