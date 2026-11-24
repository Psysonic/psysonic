import { beforeEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAllStores } from '@/test/helpers/storeReset';
import { onInvoke } from '@/test/mocks/tauri';
import { useAuthStore } from '@/store/authStore';
import { resetActiveServerConnectionSnapshot } from '@/lib/network/activeServerReachability';
import i18n from '@/lib/i18n';
import { ScrobbleActionButton } from './ScrobbleStatus';

describe('ScrobbleActionButton server probing', () => {
  beforeEach(() => {
    resetAllStores();
    resetActiveServerConnectionSnapshot();
    const id = useAuthStore.getState().addServer({
      name: 'T', url: 'https://x.test', username: 'u', password: 'p',
    });
    useAuthStore.getState().setActiveServer(id);
  });

  it('does not probe the server itself (the app shell does that)', async () => {
    let probes = 0;
    onInvoke('probe_server_connection', () => {
      probes += 1;
      return { ok: false };
    });

    renderWithProviders(<ScrobbleActionButton t={i18n.t} className="player-btn" />);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(probes).toBe(0);
  });
});
