/**
 * Shuffle on, and a caller hands a whole list to `playTrack` — a double-click
 * in an album, a playlist, "Play all" (#1572).
 *
 * Two things have to hold: the list arrives mixed with the chosen track in
 * front, and the order it arrived in is remembered, so switching shuffle off
 * puts back the list the user picked rather than the mixed one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { resetAllStores } from '@/test/helpers/storeReset';
import { makeTracks } from '@/test/helpers/factories';
import { onInvoke, registerDefaultCoverInvokeHandlers } from '@/test/mocks/tauri';
import { useAuthStore } from '@/store/authStore';

const queueIds = (): string[] =>
  usePlayerStore.getState().queueItems.map(ref => ref.trackId);

beforeEach(() => {
  resetAllStores();
  const id = useAuthStore.getState().addServer({
    name: 'T', url: 'https://shuffle.test', username: 'u', password: 'p',
  });
  useAuthStore.getState().setActiveServer(id);
  registerDefaultCoverInvokeHandlers();
  onInvoke('audio_play', () => undefined);
  onInvoke('audio_stop', () => undefined);
  onInvoke('audio_seek', () => undefined);
  onInvoke('audio_get_state', () => ({ playing: false }));
  onInvoke('audio_update_replay_gain', () => undefined);
  onInvoke('discord_update_presence', () => undefined);
  // Fisher-Yates with a fixed draw: the result is a rotation, so it differs
  // from the input for any list of two or more — enough to assert "mixed"
  // without asserting one particular permutation.
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('playTrack replacing the queue while shuffle is on', () => {
  it('mixes the list and starts on the track that was chosen', async () => {
    const album = makeTracks(6);
    usePlayerStore.setState({ shuffleMode: true });

    usePlayerStore.getState().playTrack(album[3]!, album, true, true);

    await vi.waitFor(() => {
      expect(usePlayerStore.getState().queueItems).toHaveLength(album.length);
    });
    expect(queueIds()[0]).toBe(album[3]!.id);
    expect(usePlayerStore.getState().queueIndex).toBe(0);
    // Nothing is lost and nothing is duplicated.
    expect([...queueIds()].sort()).toEqual(album.map(track => track.id).sort());
    // …and it is not simply the list in the order it came in.
    expect(queueIds()).not.toEqual(album.map(track => track.id));
  });

  it('respects an explicit index, so the row the user clicked leads', async () => {
    const album = makeTracks(5);
    usePlayerStore.setState({ shuffleMode: true });

    // Favourites and the artist page pass the index alongside the list.
    usePlayerStore.getState().playTrack(album[4]!, album, true, true, 4);

    await vi.waitFor(() => {
      expect(usePlayerStore.getState().queueItems).toHaveLength(album.length);
    });
    expect(queueIds()[0]).toBe(album[4]!.id);
    expect(usePlayerStore.getState().queueIndex).toBe(0);
  });

  it('puts the list back in its original order when shuffle is switched off', async () => {
    const album = makeTracks(6);
    usePlayerStore.setState({ shuffleMode: true });

    usePlayerStore.getState().playTrack(album[2]!, album, true, true);
    await vi.waitFor(() => {
      expect(usePlayerStore.getState().queueItems).toHaveLength(album.length);
    });
    // The restore is only worth anything if there was something to restore
    // from: assert the mixed state before switching back.
    expect(queueIds()).not.toEqual(album.map(track => track.id));

    usePlayerStore.getState().toggleShuffleMode();

    expect(usePlayerStore.getState().shuffleMode).toBe(false);
    expect(queueIds()).toEqual(album.map(track => track.id));
  });

  it('leaves the order untouched while shuffle is off', async () => {
    const album = makeTracks(6);

    usePlayerStore.getState().playTrack(album[3]!, album, true, true);

    await vi.waitFor(() => {
      expect(usePlayerStore.getState().queueItems).toHaveLength(album.length);
    });
    expect(queueIds()).toEqual(album.map(track => track.id));
    expect(usePlayerStore.getState().queueIndex).toBe(3);
  });

  it('does not touch a navigation call that hands over no queue', async () => {
    const album = makeTracks(4);
    usePlayerStore.getState().playTrack(album[0]!, album, true, true);
    await vi.waitFor(() => {
      expect(usePlayerStore.getState().queueItems).toHaveLength(album.length);
    });

    usePlayerStore.setState({ shuffleMode: true });
    usePlayerStore.getState().playTrack(album[2]!, undefined, true, true, 2);

    await vi.waitFor(() => {
      expect(usePlayerStore.getState().queueIndex).toBe(2);
    });
    expect(queueIds()).toEqual(album.map(track => track.id));
  });
});
