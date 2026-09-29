import {
  apiForServer,
  apiPostFormForServer,
  getServerById,
  isHttp414,
  serverSupportsFormPost,
} from '@/lib/api/subsonicClient';
import {
  connectBaseUrlForServer,
  normalizeServerBaseUrl,
  serverShareBaseUrl,
} from '@/lib/server/serverEndpoint';

export type SubsonicShareEntry = Record<string, unknown> & { id?: string };
export type SubsonicShareKind = 'track' | 'album' | 'artist' | 'playlist' | 'queue';

export type SubsonicShare = Record<string, unknown> & {
  id: string;
  url: string;
  description?: string;
  username?: string;
  created?: string;
  expires?: string;
  lastVisited?: string;
  visitCount?: number;
  downloadable?: boolean;
  resourceKind?: SubsonicShareKind;
  entry?: SubsonicShareEntry[];
};

type SharesResponse = {
  shares?: { share?: unknown };
  share?: unknown;
};

function asShare(value: unknown): SubsonicShare | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  const url = typeof candidate.url === 'string' ? candidate.url.trim() : '';
  if (!id || !url) return null;
  return { ...candidate, id, url } as SubsonicShare;
}

function parseShares(data: SharesResponse): SubsonicShare[] {
  const raw = data.shares?.share ?? data.share;
  if (raw === undefined || raw === null) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values.map(asShare).filter((share): share is SubsonicShare => share !== null);
}

function isHttpStatus(err: unknown, status: number): boolean {
  if (err && typeof err === 'object' && 'response' in err) {
    if ((err as { response?: { status?: number } }).response?.status === status) return true;
  }
  return err instanceof Error && new RegExp(`(^|\\D)${status}(\\D|$)`).test(err.message);
}

export function isSharingDisabledError(err: unknown): boolean {
  return isHttpStatus(err, 501);
}

function rewriteConnectOriginUrl(serverId: string, returnedUrl: string): string {
  const profile = getServerById(serverId);
  if (!profile) return returnedUrl;

  const connectBase = normalizeServerBaseUrl(connectBaseUrlForServer(profile));
  const shareBase = normalizeServerBaseUrl(serverShareBaseUrl(profile));
  if (!connectBase || !shareBase || connectBase === shareBase) return returnedUrl;

  try {
    const returned = new URL(returnedUrl);
    const connect = new URL(connectBase);
    const share = new URL(shareBase);
    const connectPath = connect.pathname.replace(/\/$/, '');
    const expectedSharePrefix = `${connectPath}/share/`;
    if (returned.origin !== connect.origin || !returned.pathname.startsWith(expectedSharePrefix)) {
      return returnedUrl;
    }
    const suffix = returned.pathname.slice(connectPath.length);
    returned.protocol = share.protocol;
    returned.hostname = share.hostname;
    returned.port = share.port;
    returned.pathname = `${share.pathname.replace(/\/$/, '')}${suffix}`;
    return returned.toString();
  } catch {
    return returnedUrl;
  }
}

export async function getSharesForServer(serverId: string): Promise<SubsonicShare[]> {
  const data = await apiForServer<SharesResponse>(serverId, 'getShares.view');
  return parseShares(data).map(share => ({
    ...share,
    url: rewriteConnectOriginUrl(serverId, share.url),
  }));
}

export async function createShareForServer(
  serverId: string,
  resourceIds: readonly string[],
  options?: { downloadable?: boolean },
): Promise<SubsonicShare> {
  const ids = resourceIds.filter(id => id.length > 0);
  if (ids.length === 0) throw new Error('Share requires at least one resource id');
  const params = {
    id: ids,
    ...(options?.downloadable === undefined ? {} : { downloadable: options.downloadable }),
  };

  let data: SharesResponse;
  if (serverSupportsFormPost(serverId)) {
    data = await apiPostFormForServer<SharesResponse>(serverId, 'createShare.view', params);
  } else {
    try {
      data = await apiForServer<SharesResponse>(serverId, 'createShare.view', params);
    } catch (err) {
      if (!isHttp414(err)) throw err;
      data = await apiPostFormForServer<SharesResponse>(serverId, 'createShare.view', params);
    }
  }

  const share = parseShares(data)[0];
  if (!share) throw new Error('Invalid createShare response: missing share id or url');
  return {
    ...share,
    url: rewriteConnectOriginUrl(serverId, share.url),
    ...(options?.downloadable === undefined ? {} : { downloadable: options.downloadable }),
  };
}

export async function deleteShareForServer(serverId: string, shareId: string): Promise<void> {
  if (!shareId.trim()) throw new Error('Missing share id');
  await apiForServer(serverId, 'deleteShare.view', { id: shareId });
}
