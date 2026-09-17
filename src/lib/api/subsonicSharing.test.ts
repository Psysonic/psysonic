import { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiForServer: vi.fn(),
  apiPostFormForServer: vi.fn(),
  formPost: false,
  profile: {
    id: 'srv-a',
    name: 'Server',
    url: 'https://music.test',
    username: 'user',
    password: 'pass',
  } as {
    id: string;
    name: string;
    url: string;
    alternateUrl?: string;
    username: string;
    password: string;
    shareUsesLocalUrl?: boolean;
  },
}));

vi.mock('@/lib/api/subsonicClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/subsonicClient')>('@/lib/api/subsonicClient');
  return {
    ...actual,
    apiForServer: mocks.apiForServer,
    apiPostFormForServer: mocks.apiPostFormForServer,
    serverSupportsFormPost: () => mocks.formPost,
    getServerById: () => mocks.profile,
  };
});

import {
  createShareForServer,
  deleteShareForServer,
  getSharesForServer,
  isSharingDisabledError,
} from '@/lib/api/subsonicSharing';

beforeEach(() => {
  mocks.apiForServer.mockReset();
  mocks.apiPostFormForServer.mockReset();
  mocks.formPost = false;
  mocks.profile = {
    id: 'srv-a',
    name: 'Server',
    url: 'https://music.test',
    username: 'user',
    password: 'pass',
  };
});

describe('Subsonic sharing API', () => {
  it('parses single and array share responses', async () => {
    mocks.apiForServer
      .mockResolvedValueOnce({ shares: { share: { id: 'one', url: 'https://music.test/share/one' } } })
      .mockResolvedValueOnce({
        shares: {
          share: [
            { id: 'one', url: 'https://music.test/share/one' },
            { id: 'two', url: 'https://music.test/share/two' },
          ],
        },
      });

    await expect(getSharesForServer('srv-a')).resolves.toHaveLength(1);
    await expect(getSharesForServer('srv-a')).resolves.toHaveLength(2);
  });

  it('uses form POST when advertised and preserves resource order', async () => {
    mocks.formPost = true;
    mocks.apiPostFormForServer.mockResolvedValue({
      shares: { share: { id: 'share-1', url: 'https://music.test/share/share-1' } },
    });

    await expect(createShareForServer('srv-a', ['track-b', 'track-a'], { downloadable: true }))
      .resolves.toMatchObject({ downloadable: true });

    expect(mocks.apiPostFormForServer).toHaveBeenCalledWith('srv-a', 'createShare.view', {
      id: ['track-b', 'track-a'],
      downloadable: true,
    });
    expect(mocks.apiForServer).not.toHaveBeenCalled();
  });

  it('uses GET and retries once with form POST after HTTP 414', async () => {
    const error = new AxiosError('Request failed');
    error.response = { status: 414, data: '', statusText: 'URI Too Long', headers: {}, config: {} as never };
    mocks.apiForServer.mockRejectedValueOnce(error);
    mocks.apiPostFormForServer.mockResolvedValue({
      shares: { share: { id: 'share-1', url: 'https://music.test/share/share-1' } },
    });

    await createShareForServer('srv-a', ['a', 'b'], { downloadable: false });

    const params = { id: ['a', 'b'], downloadable: false };
    expect(mocks.apiForServer).toHaveBeenCalledWith('srv-a', 'createShare.view', params);
    expect(mocks.apiPostFormForServer).toHaveBeenCalledWith('srv-a', 'createShare.view', params);
  });

  it('sends a native playlist id unchanged', async () => {
    mocks.apiForServer.mockResolvedValue({
      shares: { share: { id: 'share-1', url: 'https://music.test/share/share-1' } },
    });

    await createShareForServer('srv-a', ['playlist-native-id']);

    expect(mocks.apiForServer).toHaveBeenCalledWith('srv-a', 'createShare.view', {
      id: ['playlist-native-id'],
    });
  });

  it('rejects a create response without both id and url', async () => {
    mocks.apiForServer.mockResolvedValue({ shares: { share: { id: 'share-1' } } });
    await expect(createShareForServer('srv-a', ['track-1'])).rejects.toThrow('missing share id or url');
  });

  it('rewrites only a proven connect-base share URL to the public profile base', async () => {
    mocks.profile = {
      ...mocks.profile,
      url: 'http://192.168.1.10:4533/navidrome',
      alternateUrl: 'https://music.example/navidrome',
    };
    mocks.apiForServer.mockResolvedValueOnce({
      shares: { share: { id: 'share-1', url: 'http://192.168.1.10:4533/navidrome/share/share-1?x=1' } },
    });
    await expect(createShareForServer('srv-a', ['track-1'])).resolves.toMatchObject({
      url: 'https://music.example/navidrome/share/share-1?x=1',
    });

    mocks.apiForServer.mockResolvedValueOnce({
      shares: { share: { id: 'share-2', url: 'https://shares.example/public/share-2' } },
    });
    await expect(createShareForServer('srv-a', ['track-2'])).resolves.toMatchObject({
      url: 'https://shares.example/public/share-2',
    });
  });

  it('uses the public address for listed shares on a dual-address profile', async () => {
    mocks.profile = {
      ...mocks.profile,
      url: 'http://192.168.1.10:4533/navidrome',
      alternateUrl: 'https://music.example/navidrome',
      shareUsesLocalUrl: false,
    };
    mocks.apiForServer.mockResolvedValue({
      shares: {
        share: [
          { id: 'share-1', url: 'http://192.168.1.10:4533/navidrome/share/share-1' },
          { id: 'share-2', url: 'https://shares.example/public/share-2' },
        ],
      },
    });

    await expect(getSharesForServer('srv-a')).resolves.toEqual([
      expect.objectContaining({
        id: 'share-1',
        url: 'https://music.example/navidrome/share/share-1',
      }),
      expect.objectContaining({
        id: 'share-2',
        url: 'https://shares.example/public/share-2',
      }),
    ]);
  });

  it('classifies HTTP 501 and deletes by share id', async () => {
    const error = new AxiosError('Not implemented');
    error.response = { status: 501, data: '', statusText: 'Not Implemented', headers: {}, config: {} as never };
    expect(isSharingDisabledError(error)).toBe(true);
    expect(isSharingDisabledError(new Error('offline'))).toBe(false);

    mocks.apiForServer.mockResolvedValue({});
    await deleteShareForServer('srv-a', 'share-1');
    expect(mocks.apiForServer).toHaveBeenCalledWith('srv-a', 'deleteShare.view', { id: 'share-1' });
  });
});
