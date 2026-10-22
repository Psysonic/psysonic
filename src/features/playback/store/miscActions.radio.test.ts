import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InternetRadioStation } from '@/lib/api/subsonicTypes';

const mocks = vi.hoisted(() => ({
  resolveStreamUrl: vi.fn(),
  playRadioStream: vi.fn(),
  hintIfVolumeIsZero: vi.fn(),
}));

vi.mock('@/features/playback/store/volumeZeroHint', () => ({
  hintIfVolumeIsZero: mocks.hintIfVolumeIsZero,
}));

vi.mock('@/generated/bindings', () => ({
  commands: { resolveStreamUrl: mocks.resolveStreamUrl },
}));
vi.mock('@/features/playback/store/radioPlayer', () => ({
  clearRadioReconnectTimer: vi.fn(),
  playRadioStream: mocks.playRadioStream,
  prepareRadioPlaybackFromUserGesture: vi.fn(),
  setRadioVolume: vi.fn(),
}));
vi.mock('@/lib/api/audio', () => ({
  audioSeek: vi.fn(),
  audioSetVolume: vi.fn(),
  audioStop: vi.fn(() => Promise.resolve()),
}));

import { _resetEngineStateForTest } from './engineState';
import { createMiscActions } from './miscActions';
import type { PlayerState } from './playerStoreTypes';

const STATION_A: InternetRadioStation = {
  id: 'shared',
  serverId: 'srv-a',
  name: 'Alpha',
  streamUrl: 'https://a.test/listen.m3u',
};
const STATION_B: InternetRadioStation = {
  id: 'shared',
  serverId: 'srv-b',
  name: 'Beta',
  streamUrl: 'https://b.test/live',
};

function createHarness() {
  let state = { volume: 1 } as PlayerState;
  const set = (partial: Partial<PlayerState> | ((current: PlayerState) => Partial<PlayerState>)) => {
    state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) };
  };
  const get = () => state;
  return { actions: createMiscActions(set, get), getState: get };
}

describe('playRadio stale request protection', () => {
  beforeEach(() => {
    _resetEngineStateForTest();
    mocks.resolveStreamUrl.mockReset();
    mocks.playRadioStream.mockReset().mockResolvedValue(undefined);
  });

  it('does not start a station whose playlist resolution completed after a newer request', async () => {
    let resolveFirst: ((url: string) => void) | undefined;
    mocks.resolveStreamUrl
      .mockImplementationOnce(() => new Promise<string>(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(STATION_B.streamUrl);
    const { actions, getState } = createHarness();

    const first = actions.playRadio(STATION_A);
    await actions.playRadio(STATION_B);
    resolveFirst?.('https://a.test/live');
    await first;

    expect(mocks.playRadioStream).toHaveBeenCalledTimes(1);
    expect(mocks.playRadioStream).toHaveBeenCalledWith(STATION_B.streamUrl, 1);
    expect(getState().currentRadio).toEqual(STATION_B);
  });

  it('does not publish stale state when an older play call settles last', async () => {
    let finishFirstPlay: (() => void) | undefined;
    mocks.resolveStreamUrl.mockImplementation((url: string) => Promise.resolve(url));
    mocks.playRadioStream
      .mockImplementationOnce(() => new Promise<void>(resolve => { finishFirstPlay = resolve; }))
      .mockResolvedValueOnce(undefined);
    const { actions, getState } = createHarness();

    const first = actions.playRadio(STATION_A);
    await vi.waitFor(() => expect(mocks.playRadioStream).toHaveBeenCalledTimes(1));
    await actions.playRadio(STATION_B);
    finishFirstPlay?.();
    await first;

    expect(getState().currentRadio).toEqual(STATION_B);
  });
});

describe('playRadio volume hint', () => {
  it('hands the current volume to the volume-at-0 hint', async () => {
    _resetEngineStateForTest();
    mocks.hintIfVolumeIsZero.mockClear();
    mocks.resolveStreamUrl.mockReset().mockResolvedValue(STATION_A.streamUrl);
    mocks.playRadioStream.mockReset().mockResolvedValue(undefined);
    const { actions } = createHarness();

    await actions.playRadio(STATION_A);

    expect(mocks.hintIfVolumeIsZero).toHaveBeenCalledWith(1);
  });
});
