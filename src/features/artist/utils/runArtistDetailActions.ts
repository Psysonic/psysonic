import type React from 'react';
import type { TFunction } from 'i18next';
import { uploadArtistImageForServer } from '@/lib/api/subsonicArtists';
import { setRating, star, unstar } from '@/lib/api/subsonicStarRating';
import type { SubsonicArtist } from '@/lib/api/subsonicTypes';
import { useAuthStore } from '@/store/authStore';
import { ensureCoverTierDiskSrc, invalidateCoverEntity } from '@/cover';
import type { CoverArtRef } from '@/cover/types';
import { showToast } from '@/lib/dom/toast';

export interface RunArtistEntityRatingDeps {
  artist: SubsonicArtist | null;
  id: string | undefined;
  rating: number;
  artistEntityRatingSupport: string;
  serverId: string;
  t: TFunction;
  setArtistEntityRating: (v: number) => void;
  setArtist: React.Dispatch<React.SetStateAction<SubsonicArtist | null>>;
}

export async function runArtistEntityRating(deps: RunArtistEntityRatingDeps): Promise<void> {
  const { artist, id, rating, artistEntityRatingSupport, serverId, t, setArtistEntityRating, setArtist } = deps;
  if (!artist || artist.id !== id) return;
  const artistId = artist.id;
  const ratingAtStart = artist.userRating ?? 0;

  setArtistEntityRating(rating);

  if (artistEntityRatingSupport !== 'full') return;

  const ownerServerId = artist.serverId ?? serverId;
  try {
    await setRating(artistId, rating, { serverId: ownerServerId, kind: 'artist' });
    setArtist(a => (a && a.id === artistId ? { ...a, userRating: rating } : a));
  } catch (err) {
    setArtistEntityRating(ratingAtStart);
    useAuthStore.getState().setEntityRatingSupport(ownerServerId, 'track_only');
    showToast(
      typeof err === 'string' ? err : err instanceof Error ? err.message : t('entityRating.saveFailed'),
      4500,
      'error',
    );
  }
}

export interface RunArtistToggleStarDeps {
  artist: SubsonicArtist | null;
  isStarred: boolean;
  setIsStarred: React.Dispatch<React.SetStateAction<boolean>>;
}

export async function runArtistToggleStar(deps: RunArtistToggleStarDeps): Promise<void> {
  const { artist, isStarred, setIsStarred } = deps;
  if (!artist) return;
  const currentlyStarred = isStarred;
  setIsStarred(!currentlyStarred);
  try {
    const meta = {
      serverId: artist.serverId,
      name: artist.name,
      albumCount: artist.albumCount,
    };
    if (currentlyStarred) await unstar(artist.id, 'artist', meta);
    else await star(artist.id, 'artist', meta);
  } catch (e) {
    console.error('Failed to toggle star', e);
    setIsStarred(currentlyStarred);
  }
}

export interface RunArtistImageUploadDeps {
  e: React.ChangeEvent<HTMLInputElement>;
  artist: SubsonicArtist | null;
  /** The artist cover every surface on the page renders — dropped from all caches after the upload. */
  coverRef: CoverArtRef | null;
  serverId: string;
  t: TFunction;
  setUploading: (v: boolean) => void;
  setCoverRevision: React.Dispatch<React.SetStateAction<number>>;
}

export async function runArtistImageUpload(deps: RunArtistImageUploadDeps): Promise<void> {
  const { e, artist, coverRef, serverId, t, setUploading, setCoverRevision } = deps;
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file || !artist) return;
  setUploading(true);
  try {
    const ownerServerId = artist.serverId ?? serverId;
    await uploadArtistImageForServer(ownerServerId, artist.id, file);
    if (coverRef) {
      await invalidateCoverEntity(coverRef);
      // Fetch full-res before the remount: the header backdrop asks for 2000,
      // and the grid ladder would otherwise hand it the first smaller tier the
      // avatar writes — it then never asks for 2000 again this session.
      await ensureCoverTierDiskSrc(coverRef, 2000).catch(() => '');
    }
    setCoverRevision(r => r + 1);
    showToast(t('artistDetail.uploadImage'));
  } catch (err) {
    showToast(
      typeof err === 'string' ? err : err instanceof Error ? err.message : t('artistDetail.uploadImageError'),
      4000,
      'error',
    );
  } finally {
    setUploading(false);
  }
}
