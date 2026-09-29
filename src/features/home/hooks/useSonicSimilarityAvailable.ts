import { useMemo } from 'react';
import { isSonicSimilarityActiveForServer } from '@/lib/serverCapabilities/storeView';
import { useAuthStore } from '@/store/authStore';

/**
 * True when at least one saved server answers similarity through AudioMuse's
 * sonic strategy — the condition under which the "Because you listened"
 * AudioMuse source can do anything. Re-evaluates once a capability probe settles.
 */
export function useSonicSimilarityAvailable(): boolean {
  const servers = useAuthStore(s => s.servers);
  const identities = useAuthStore(s => s.subsonicServerIdentityByServer);
  const pluginProbes = useAuthStore(s => s.audiomusePluginProbeByServer);
  const extensions = useAuthStore(s => s.openSubsonicExtensionsByServer);
  const legacyProbes = useAuthStore(s => s.instantMixProbeByServer);
  const manualAudiomuse = useAuthStore(s => s.audiomuseNavidromeByServer);
  return useMemo(
    () => servers.some(server => isSonicSimilarityActiveForServer(server.id)),
    // The selector reads the store directly; these are the fields it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [servers, identities, pluginProbes, extensions, legacyProbes, manualAudiomuse],
  );
}
