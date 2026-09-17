import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetShareSettingsStoreForTest,
  useShareSettingsStore,
} from '@/features/share/store/shareSettingsStore';

beforeEach(() => {
  localStorage.clear();
  _resetShareSettingsStoreForTest();
});

describe('shareSettingsStore', () => {
  it('keeps Navidrome sharing opt-in', () => {
    expect(useShareSettingsStore.getState().navidromeSharingEnabled).toBe(false);
    expect(useShareSettingsStore.getState().navidromeSharesDownloadable).toBe(false);

    useShareSettingsStore.getState().setNavidromeSharingEnabled(true);
    useShareSettingsStore.getState().setNavidromeSharesDownloadable(true);

    expect(useShareSettingsStore.getState().navidromeSharingEnabled).toBe(true);
    expect(useShareSettingsStore.getState().navidromeSharesDownloadable).toBe(true);
    expect(localStorage.getItem('psysonic_share_settings')).toContain('navidromeSharingEnabled');
  });
});
