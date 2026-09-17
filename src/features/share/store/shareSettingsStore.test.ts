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

  it('persists collapsed servers and known share metadata', () => {
    const store = useShareSettingsStore.getState();

    store.toggleServerCollapsed('srv-a');
    store.rememberShareDownloadable('srv-a', 'share-1', true);
    store.rememberShareDownloadable('srv-a', 'share-2', false);
    store.rememberShareKind('srv-a', 'share-1', 'playlist');

    expect(useShareSettingsStore.getState()).toMatchObject({
      collapsedServerIds: { 'srv-a': true },
      shareDownloadableByServer: {
        'srv-a': { 'share-1': true, 'share-2': false },
      },
      shareKindByServer: {
        'srv-a': { 'share-1': 'playlist' },
      },
    });
    expect(localStorage.getItem('psysonic_share_settings')).toContain('collapsedServerIds');
    expect(localStorage.getItem('psysonic_share_settings')).toContain('shareDownloadableByServer');
    expect(localStorage.getItem('psysonic_share_settings')).toContain('shareKindByServer');

    store.forgetShareDownloadable('srv-a', 'share-1');
    expect(useShareSettingsStore.getState().shareDownloadableByServer).toEqual({
      'srv-a': { 'share-2': false },
    });
    store.forgetShareKind('srv-a', 'share-1');
    expect(useShareSettingsStore.getState().shareKindByServer).toEqual({});
  });
});
