import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';
import { makeServer } from '@/test/helpers/factories';
import { resetAuthStore } from '@/test/helpers/storeReset';

const api = vi.hoisted(() => ({
  getSharesForServer: vi.fn(),
  createShareForServer: vi.fn(),
  deleteShareForServer: vi.fn(),
}));

vi.mock('@/lib/api/subsonicSharing', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/subsonicSharing')>('@/lib/api/subsonicSharing');
  return { ...actual, ...api };
});

import { useAuthStore } from '@/store/authStore';
import { _resetShareStoreForTest, useShareStore } from '@/features/share/store/shareStore';
import { _resetShareSettingsStoreForTest, useShareSettingsStore } from '@/features/share/store/shareSettingsStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  resetAuthStore();
  _resetShareStoreForTest();
  _resetShareSettingsStoreForTest();
  useShareSettingsStore.getState().setNavidromeSharingEnabled(true);
  vi.clearAllMocks();
});

describe('shareStore', () => {
  it('does not call Navidrome APIs while the integration is disabled', async () => {
    const server = makeServer({ id: 'srv-a' });
    useAuthStore.setState({ servers: [server] });
    useShareStore.setState({
      byServer: {
        'srv-a': {
          shares: [{ id: 'stale', url: 'https://server.test/share/stale' }],
          loading: false,
          lastSuccessfulRefresh: 1,
          availability: 'available',
        },
      },
    });
    useShareSettingsStore.getState().rememberShareDownloadable('srv-a', 'stale', true);
    useShareSettingsStore.getState().rememberShareKind('srv-a', 'stale', 'artist');
    useShareSettingsStore.getState().setNavidromeSharingEnabled(false);

    await useShareStore.getState().refreshAll();
    await expect(useShareStore.getState().createShare('srv-a', ['track-1']))
      .rejects.toThrow('disabled in settings');

    expect(api.getSharesForServer).not.toHaveBeenCalled();
    expect(api.createShareForServer).not.toHaveBeenCalled();
    expect(useShareStore.getState().byServer).toEqual({});
    expect(useShareSettingsStore.getState().shareDownloadableByServer).toEqual({
      'srv-a': { stale: true },
    });
    expect(useShareSettingsStore.getState().shareKindByServer).toEqual({
      'srv-a': { stale: 'artist' },
    });
  });

  it('explicitly disables downloads for new shares by default', async () => {
    const server = makeServer({ id: 'srv-a' });
    useAuthStore.setState({
      servers: [server],
      subsonicServerIdentityByServer: { 'srv-a': { type: 'navidrome', serverVersion: '0.64.0' } },
    });
    api.createShareForServer.mockResolvedValue({ id: 'share-1', url: 'https://a.test/share/1' });

    await useShareStore.getState().createShare('srv-a', ['track-1']);

    expect(api.createShareForServer).toHaveBeenCalledWith(
      'srv-a',
      ['track-1'],
      { downloadable: false },
    );
    expect(useShareStore.getState().byServer['srv-a']?.shares[0]).toMatchObject({
      id: 'share-1',
      downloadable: false,
    });
    expect(useShareSettingsStore.getState().shareDownloadableByServer).toEqual({
      'srv-a': { 'share-1': false },
    });
  });

  it('restores known metadata after a server refresh', async () => {
    const server = makeServer({ id: 'srv-a' });
    useAuthStore.setState({
      servers: [server],
      subsonicServerIdentityByServer: { 'srv-a': { type: 'navidrome', serverVersion: '0.64.0' } },
    });
    useShareSettingsStore.getState().rememberShareDownloadable('srv-a', 'share-1', true);
    useShareSettingsStore.getState().rememberShareKind('srv-a', 'share-1', 'queue');
    api.getSharesForServer.mockResolvedValue([{ id: 'share-1', url: 'https://a.test/share/1' }]);

    await useShareStore.getState().refreshServer('srv-a');

    expect(useShareStore.getState().byServer['srv-a']?.shares[0]).toMatchObject({
      id: 'share-1',
      downloadable: true,
      resourceKind: 'queue',
    });
  });

  it('deduplicates refreshes for one profile', async () => {
    const server = makeServer({ id: 'srv-a' });
    useAuthStore.setState({
      servers: [server],
      subsonicServerIdentityByServer: { 'srv-a': { type: 'navidrome', serverVersion: '0.64.0' } },
    });
    const request = deferred<Array<{ id: string; url: string }>>();
    api.getSharesForServer.mockReturnValue(request.promise);

    const first = useShareStore.getState().refreshServer('srv-a');
    const second = useShareStore.getState().refreshServer('srv-a');
    expect(api.getSharesForServer).toHaveBeenCalledTimes(1);

    request.resolve([{ id: 'share-1', url: 'https://server.test/share/1' }]);
    await Promise.all([first, second]);
    expect(useShareStore.getState().byServer['srv-a']).toMatchObject({
      availability: 'available',
      loading: false,
      shares: [{ id: 'share-1', url: 'https://server.test/share/1' }],
    });
  });

  it('keeps successful servers when another refresh fails with HTTP 501', async () => {
    const first = makeServer({ id: 'srv-a' });
    const second = makeServer({ id: 'srv-b' });
    useAuthStore.setState({
      servers: [first, second],
      libraryBrowseServerIds: ['srv-a', 'srv-b'],
      subsonicServerIdentityByServer: {
        'srv-a': { type: 'navidrome', serverVersion: '0.64.0' },
        'srv-b': { type: 'navidrome', serverVersion: '0.64.0' },
      },
    });
    const disabled = new AxiosError('Not implemented');
    disabled.response = { status: 501, data: '', statusText: 'Not Implemented', headers: {}, config: {} as never };
    api.getSharesForServer.mockImplementation((serverId: string) => (
      serverId === 'srv-a'
        ? Promise.resolve([{ id: 'share-1', url: 'https://a.test/share/1' }])
        : Promise.reject(disabled)
    ));

    await useShareStore.getState().refreshAll();

    expect(useShareStore.getState().byServer['srv-a']?.shares).toHaveLength(1);
    expect(useShareStore.getState().byServer['srv-b']?.availability).toBe('sharing_disabled');
  });

  it('refreshes only servers selected in the library browse scope', async () => {
    const first = makeServer({ id: 'srv-a' });
    const second = makeServer({ id: 'srv-b' });
    useAuthStore.setState({
      servers: [first, second],
      activeServerId: 'srv-a',
      libraryBrowseServerIds: ['srv-b'],
      subsonicServerIdentityByServer: {
        'srv-a': { type: 'navidrome', serverVersion: '0.64.0' },
        'srv-b': { type: 'navidrome', serverVersion: '0.64.0' },
      },
    });
    api.getSharesForServer.mockResolvedValue([]);

    await useShareStore.getState().refreshAll();

    expect(api.getSharesForServer).toHaveBeenCalledOnce();
    expect(api.getSharesForServer).toHaveBeenCalledWith('srv-b');
    expect(useShareStore.getState().byServer['srv-a']).toBeUndefined();
  });

  it('inserts created shares and removes only after successful deletion', async () => {
    const server = makeServer({ id: 'srv-a' });
    useAuthStore.setState({
      servers: [server],
      subsonicServerIdentityByServer: { 'srv-a': { type: 'navidrome', serverVersion: '0.64.0' } },
    });
    api.createShareForServer.mockResolvedValue({ id: 'share-1', url: 'https://a.test/share/1' });
    api.deleteShareForServer.mockResolvedValue(undefined);
    useShareSettingsStore.getState().setNavidromeSharesDownloadable(true);

    await useShareStore.getState().createShare('srv-a', ['playlist-native-id'], 'playlist');
    expect(api.createShareForServer).toHaveBeenCalledWith(
      'srv-a',
      ['playlist-native-id'],
      { downloadable: true },
    );
    expect(useShareStore.getState().byServer['srv-a']?.shares.map(share => share.id)).toEqual(['share-1']);
    expect(useShareStore.getState().byServer['srv-a']?.shares[0]?.resourceKind).toBe('playlist');
    expect(useShareSettingsStore.getState().shareKindByServer).toEqual({
      'srv-a': { 'share-1': 'playlist' },
    });

    api.deleteShareForServer.mockRejectedValueOnce(new Error('offline'));
    await expect(useShareStore.getState().deleteShare('srv-a', 'share-1')).rejects.toThrow('offline');
    expect(useShareStore.getState().byServer['srv-a']?.shares).toHaveLength(1);

    await useShareStore.getState().deleteShare('srv-a', 'share-1');
    expect(useShareStore.getState().byServer['srv-a']?.shares).toEqual([]);
    expect(useShareSettingsStore.getState().shareDownloadableByServer).toEqual({});
    expect(useShareSettingsStore.getState().shareKindByServer).toEqual({});
  });

  it('drops stale refresh results after credentials change', async () => {
    const server = makeServer({ id: 'srv-a', password: 'old' });
    useAuthStore.setState({
      servers: [server],
      subsonicServerIdentityByServer: { 'srv-a': { type: 'navidrome', serverVersion: '0.64.0' } },
    });
    const request = deferred<Array<{ id: string; url: string }>>();
    api.getSharesForServer.mockReturnValue(request.promise);
    const refresh = useShareStore.getState().refreshServer('srv-a');

    useAuthStore.setState({ servers: [{ ...server, password: 'new' }] });
    useShareStore.getState().reconcileProfiles();
    request.resolve([{ id: 'stale', url: 'https://a.test/share/stale' }]);
    await refresh;

    expect(useShareStore.getState().byServer['srv-a']).toBeUndefined();
  });

  it('does not let an older refresh overwrite a newly created share', async () => {
    const server = makeServer({ id: 'srv-a' });
    useAuthStore.setState({
      servers: [server],
      subsonicServerIdentityByServer: { 'srv-a': { type: 'navidrome', serverVersion: '0.64.0' } },
    });
    const request = deferred<Array<{ id: string; url: string }>>();
    api.getSharesForServer.mockReturnValue(request.promise);
    api.createShareForServer.mockResolvedValue({ id: 'created', url: 'https://a.test/share/created' });
    const refresh = useShareStore.getState().refreshServer('srv-a');

    await useShareStore.getState().createShare('srv-a', ['track-1']);
    request.resolve([{ id: 'old', url: 'https://a.test/share/old' }]);
    await refresh;

    expect(useShareStore.getState().byServer['srv-a']).toMatchObject({
      loading: false,
      shares: [{ id: 'created', url: 'https://a.test/share/created' }],
    });
  });

  it('clears removed server state without touching another server', async () => {
    const first = makeServer({ id: 'srv-a' });
    const second = makeServer({ id: 'srv-b' });
    useAuthStore.setState({
      servers: [first, second],
      libraryBrowseServerIds: ['srv-a', 'srv-b'],
      subsonicServerIdentityByServer: {
        'srv-a': { type: 'navidrome', serverVersion: '0.64.0' },
        'srv-b': { type: 'navidrome', serverVersion: '0.64.0' },
      },
    });
    api.getSharesForServer.mockImplementation((serverId: string) => Promise.resolve([
      { id: `share-${serverId}`, url: `https://${serverId}.test/share/1` },
    ]));
    await useShareStore.getState().refreshAll();
    useShareSettingsStore.getState().rememberShareDownloadable('srv-a', 'share-srv-a', true);
    useShareSettingsStore.getState().rememberShareKind('srv-a', 'share-srv-a', 'queue');
    useShareSettingsStore.getState().rememberShareDownloadable('srv-b', 'share-srv-b', false);
    useShareSettingsStore.getState().rememberShareKind('srv-b', 'share-srv-b', 'playlist');

    useAuthStore.setState({ servers: [second] });
    useShareStore.getState().reconcileProfiles();

    expect(useShareStore.getState().byServer['srv-a']).toBeUndefined();
    expect(useShareStore.getState().byServer['srv-b']?.shares).toHaveLength(1);
    expect(useShareSettingsStore.getState().shareDownloadableByServer).toEqual({
      'srv-b': { 'share-srv-b': false },
    });
    expect(useShareSettingsStore.getState().shareKindByServer).toEqual({
      'srv-b': { 'share-srv-b': 'playlist' },
    });
  });
});
