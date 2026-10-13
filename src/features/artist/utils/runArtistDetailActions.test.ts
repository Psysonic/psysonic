import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type React from 'react';
import {
  runArtistEntityRating,
  runArtistImageUpload,
} from '@/features/artist/utils/runArtistDetailActions';
import { uploadArtistImageForServer } from '@/lib/api/subsonicArtists';
import { ensureCoverTierDiskSrc, invalidateCoverEntity } from '@/cover';
import type { CoverArtRef } from '@/cover/types';
import { setRating } from '@/lib/api/subsonicStarRating';
import { useAuthStore } from '@/store/authStore';
import { resetAuthStore } from '@/test/helpers/storeReset';

vi.mock('@/lib/api/subsonicArtists', () => ({
  uploadArtistImageForServer: vi.fn(async () => undefined),
}));
vi.mock('@/cover', () => ({
  invalidateCoverEntity: vi.fn(async () => undefined),
  ensureCoverTierDiskSrc: vi.fn(async () => 'asset://artist/2000.webp'),
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

  const coverRef: CoverArtRef = {
    cacheKind: 'artist',
    cacheEntityId: 'cover-1',
    fetchCoverArtId: 'cover-1',
    serverScope: { kind: 'active' },
  };

  function pickedFile(): { input: HTMLInputElement; file: File } {
    const input = document.createElement('input');
    const file = new File(['image'], 'artist.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    return { input, file };
  }

  it('uploads against the resolved detail server and drops the page cover from every cache', async () => {
    const { input, file } = pickedFile();
    const setUploading = vi.fn();
    const setCoverRevision = vi.fn();

    await runArtistImageUpload({
      e: { target: input } as React.ChangeEvent<HTMLInputElement>,
      artist: { id: 'artist-1', name: 'Artist', coverArt: 'cover-1' },
      coverRef,
      serverId: 'srv-detail',
      t,
      setUploading,
      setCoverRevision,
    });

    expect(uploadArtistImageForServer).toHaveBeenCalledWith('srv-detail', 'artist-1', file);
    expect(invalidateCoverEntity).toHaveBeenCalledExactlyOnceWith(coverRef);
    expect(ensureCoverTierDiskSrc).toHaveBeenCalledExactlyOnceWith(coverRef, 2000);
    const order = (fn: unknown) => vi.mocked(fn as () => void).mock.invocationCallOrder[0];
    expect(order(invalidateCoverEntity)).toBeLessThan(order(ensureCoverTierDiskSrc));
    expect(order(ensureCoverTierDiskSrc)).toBeLessThan(order(setCoverRevision));
    expect(setUploading).toHaveBeenNthCalledWith(1, true);
    expect(setUploading).toHaveBeenLastCalledWith(false);
    expect(setCoverRevision).toHaveBeenCalledOnce();
  });

  it('still bumps the cover revision when there is no cover ref to invalidate', async () => {
    const { input } = pickedFile();
    const setCoverRevision = vi.fn();

    await runArtistImageUpload({
      e: { target: input } as React.ChangeEvent<HTMLInputElement>,
      artist: { id: 'artist-1', name: 'Artist' },
      coverRef: null,
      serverId: 'srv-detail',
      t,
      setUploading: vi.fn(),
      setCoverRevision,
    });

    expect(invalidateCoverEntity).not.toHaveBeenCalled();
    expect(ensureCoverTierDiskSrc).not.toHaveBeenCalled();
    expect(setCoverRevision).toHaveBeenCalledOnce();
  });

  it('still remounts when the full-res prefetch fails', async () => {
    vi.mocked(ensureCoverTierDiskSrc).mockRejectedValueOnce(new Error('handshake'));
    const { input } = pickedFile();
    const setCoverRevision = vi.fn();

    await runArtistImageUpload({
      e: { target: input } as React.ChangeEvent<HTMLInputElement>,
      artist: { id: 'artist-1', name: 'Artist', coverArt: 'cover-1' },
      coverRef,
      serverId: 'srv-detail',
      t,
      setUploading: vi.fn(),
      setCoverRevision,
    });

    expect(setCoverRevision).toHaveBeenCalledOnce();
  });
});
