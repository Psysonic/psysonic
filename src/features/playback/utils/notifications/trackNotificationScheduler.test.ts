import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/generated/bindings', () => ({ commands: { showTrackNotification: vi.fn() } }));

import {
  createTrackNotificationScheduler,
  type TrackNotificationRequest,
} from './trackNotificationScheduler';

const request = (title: string): TrackNotificationRequest => ({ title, body: '', coverPath: null });

function setup(enabled = true) {
  const show = vi.fn(() => Promise.resolve());
  const state = { enabled };
  const scheduler = createTrackNotificationScheduler({
    settleMs: 1000,
    isEnabled: () => state.enabled,
    show,
  });
  return { scheduler, show, state };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createTrackNotificationScheduler', () => {
  it('shows a track only once it stayed current for the settle time', async () => {
    const { scheduler, show } = setup();
    scheduler.announce('a', async () => request('A'), () => true);

    await vi.advanceTimersByTimeAsync(999);
    expect(show).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(show).toHaveBeenCalledWith(request('A'));
  });

  it('announces only the track playback settles on when skipping', async () => {
    const { scheduler, show } = setup();
    scheduler.announce('a', async () => request('A'), () => true);
    await vi.advanceTimersByTimeAsync(500);
    scheduler.announce('b', async () => request('B'), () => true);
    await vi.advanceTimersByTimeAsync(500);
    scheduler.announce('c', async () => request('C'), () => true);
    await vi.advanceTimersByTimeAsync(1000);

    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith(request('C'));
  });

  it('stays silent while the setting is off, also when it turns off during the wait', async () => {
    const { scheduler, show, state } = setup(false);
    scheduler.announce('a', async () => request('A'), () => true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(show).not.toHaveBeenCalled();

    state.enabled = true;
    scheduler.announce('b', async () => request('B'), () => true);
    state.enabled = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(show).not.toHaveBeenCalled();
  });

  it('does not show a track that stopped being current', async () => {
    const { scheduler, show } = setup();
    let current = true;
    scheduler.announce('a', async () => request('A'), () => current);
    current = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(show).not.toHaveBeenCalled();
  });

  it('drops the notification when the track changes while its cover resolves', async () => {
    const { scheduler, show } = setup();
    let current = true;
    scheduler.announce('a', async () => {
      current = false;
      return request('A');
    }, () => current);
    await vi.advanceTimersByTimeAsync(1000);
    expect(show).not.toHaveBeenCalled();
  });

  it('never announces the same key twice in a row', async () => {
    const { scheduler, show } = setup();
    scheduler.announce('a', async () => request('A'), () => true);
    await vi.advanceTimersByTimeAsync(1000);
    scheduler.announce('a', async () => request('A'), () => true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(show).toHaveBeenCalledTimes(1);

    scheduler.announce('b', async () => request('B'), () => true);
    await vi.advanceTimersByTimeAsync(1000);
    scheduler.announce('a', async () => request('A'), () => true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(show).toHaveBeenCalledTimes(3);
  });

  it('cancels a pending notification on dispose', async () => {
    const { scheduler, show } = setup();
    scheduler.announce('a', async () => request('A'), () => true);
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(show).not.toHaveBeenCalled();
  });
});
