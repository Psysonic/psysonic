import { serverIndexKeyFromUrl } from './serverBaseUrl';

export interface ExternalCatalogState {
  servers: readonly { id: string; url: string }[];
  openSubsonicExtensionsByServer?: Record<string, readonly string[]>;
  subsonicServerIdentityByServer?: Record<string, { type?: string }>;
}

export function hasOctoExtensions(extensions: readonly string[]): boolean {
  return extensions.some(extension => (
    extension === 'octoAcquisitions' || extension === 'octoStations' || extension === 'octoImports'
  ));
}

/** Octo's ping can relay Navidrome's identity; its extensions describe the proxy. */
export function serverHasExternalCatalog(state: ExternalCatalogState, serverId: string): boolean {
  const owners = state.servers.filter(server => (
    server.id === serverId || serverIndexKeyFromUrl(server.url) === serverId
  ));
  return owners.some(server => (
    state.subsonicServerIdentityByServer?.[server.id]?.type?.toLowerCase() === 'octo'
    || hasOctoExtensions(state.openSubsonicExtensionsByServer?.[server.id] ?? [])
  ));
}

/** Available before Zustand hydration, including to the canonical-ID bootstrap. */
export function storedServerHasExternalCatalog(
  serverId: string,
  storage: Pick<Storage, 'getItem'> = localStorage,
): boolean {
  try {
    const state = JSON.parse(storage.getItem('psysonic-auth') ?? 'null')?.state;
    if (!state || !Array.isArray(state.servers)) return false;
    return serverHasExternalCatalog(state, serverId);
  } catch {
    return false;
  }
}
