import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { emitTauriEvent, listenMock } from '@/test/mocks/tauri';

vi.mock('@/cover/diskSrcCache', async importOriginal => ({
  ...(await importOriginal<typeof import('@/cover/diskSrcCache')>()),
  refreshDiskSrcVersions: vi.fn(),
}));

import { refreshDiskSrcVersions } from '@/cover/diskSrcCache';
import { useCoverArtBridge } from './useCoverArtBridge';

describe('useCoverArtBridge — cover:tiers-rewritten', () => {
  it('hands the rewritten files to the disk-src cache', async () => {
    renderHook(() => useCoverArtBridge());
    await waitFor(() =>
      expect(listenMock).toHaveBeenCalledWith('cover:tiers-rewritten', expect.any(Function)),
    );

    emitTauriEvent('cover:tiers-rewritten', { paths: ['/cache/pl-1/128.webp|200'] });

    expect(refreshDiskSrcVersions).toHaveBeenCalledWith(['/cache/pl-1/128.webp|200']);
  });
});
