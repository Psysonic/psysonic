import { beforeEach, describe, expect, it } from 'vitest';
import { makeTrack } from '@/test/helpers/factories';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';
import { serverIndexKeyFromUrl } from '@/lib/server/serverIndexKey';
import { nowPlayingMatches } from '@/features/playback/utils/playback/nowPlayingMatch';
import type { QueueSource } from '@/features/playback/store/pendingQueueSource';

const state = (track = makeTrack({ albumId: 'al-1', artistId: 'ar-1', serverId: 'srv' }), queueSource: QueueSource | null = null) =>
  ({ currentTrack: track, queueSource });

beforeEach(() => {
  resetAuthStore();
});

describe('nowPlayingMatches', () => {
  it('matches the album of the current track', () => {
    expect(nowPlayingMatches(state(), 'album', 'al-1', 'srv')).toBe(true);
    expect(nowPlayingMatches(state(), 'album', 'al-2', 'srv')).toBe(false);
  });

  it('matches the primary artist and every credited performer', () => {
    const track = makeTrack({ artistId: 'ar-1', artists: [{ id: 'ar-1', name: 'Lead' }, { id: 'ar-2', name: 'Guest' }] });
    expect(nowPlayingMatches(state(track), 'artist', 'ar-1')).toBe(true);
    expect(nowPlayingMatches(state(track), 'artist', 'ar-2')).toBe(true);
    expect(nowPlayingMatches(state(track), 'artist', 'ar-3')).toBe(false);
  });

  it('keeps the same id on another server apart', () => {
    expect(nowPlayingMatches(state(), 'album', 'al-1', 'other-srv')).toBe(false);
  });

  it('treats a profile id and its index key as the same server', () => {
    const profileId = useAuthStore.getState().addServer({
      name: 'Home', url: 'https://music.example.test', username: 'tester', password: 'p',
    });
    const track = makeTrack({ albumId: 'al-1', serverId: profileId });
    const indexKey = serverIndexKeyFromUrl('https://music.example.test');
    expect(indexKey).not.toBe(profileId);
    expect(nowPlayingMatches(state(track), 'album', 'al-1', indexKey)).toBe(true);
  });

  it('matches a playlist only through the queue source, never through the track', () => {
    const source: QueueSource = { kind: 'playlist', id: 'pl-1', serverId: 'srv' };
    expect(nowPlayingMatches(state(undefined, source), 'playlist', 'pl-1', 'srv')).toBe(true);
    expect(nowPlayingMatches(state(undefined, source), 'playlist', 'pl-2', 'srv')).toBe(false);
    expect(nowPlayingMatches(state(), 'playlist', 'pl-1', 'srv')).toBe(false);
  });

  it('matches nothing while no track plays (radio, cleared queue)', () => {
    const source: QueueSource = { kind: 'playlist', id: 'pl-1' };
    const idle = { currentTrack: null, queueSource: source };
    expect(nowPlayingMatches(idle, 'album', 'al-1')).toBe(false);
    expect(nowPlayingMatches(idle, 'playlist', 'pl-1')).toBe(false);
  });
});
