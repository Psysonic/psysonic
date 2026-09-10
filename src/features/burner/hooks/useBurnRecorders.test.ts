import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onInvoke } from '@/test/mocks/tauri';
import type { BurnMediaInfo, BurnRecorder } from '@/lib/api/burn';
import { _resetBurnSupportForTest } from '@/features/burner/store/burnSupportStore';
import { useBurnRecorders } from './useBurnRecorders';

/** Mirrors MEDIA_POLL_MS, which the hook keeps private. */
const POLL_MS = 3000;

const RECORDER: BurnRecorder = {
  id: 'drive-1',
  name: 'HL-DT-ST BD-RE WH16NS40',
  volumePaths: ['E:\\'],
  canWriteCd: true,
  supportsCdText: true,
  capabilities: {
    reported: true,
    sessionAtOnce: true,
    rawRecording: false,
    rawMultisession: false,
    testWrite: true,
    cdRewritable: true,
    rwSubchannel: true,
    bufferUnderrunFree: true,
    maxCueSheetBytes: 4096,
  },
};

const EMPTY_TRAY: BurnMediaInfo = {
  present: false,
  blank: false,
  erasable: false,
  mediaType: '',
  capacitySectors: 0,
  writeSpeeds: [],
  blocker: null,
};

const BLANK_CDR: BurnMediaInfo = {
  present: true,
  blank: true,
  erasable: false,
  mediaType: 'CD-R',
  capacitySectors: 359_849,
  writeSpeeds: [1764, 882],
  blocker: null,
};

/** What the fake drive holds, and the fingerprint it answers `burn_media_state` with. */
let token = 'tray-empty';
let media = EMPTY_TRAY;
let probes = 0;

/**
 * Advance the poll clock and let the effects settle.
 *
 * The effects are layered — the support probe releases the drive list, which
 * releases the media probe — and each layer's IPC only starts once the layer
 * above it has re-rendered, so a single drain never reaches the bottom.
 */
async function settle(ms = 0): Promise<void> {
  for (let step = 0; step < 4; step += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step === 0 ? ms : 0);
    });
  }
}

describe('useBurnRecorders media poll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetBurnSupportForTest();
    token = 'tray-empty';
    media = EMPTY_TRAY;
    probes = 0;
    onInvoke('burn_is_supported', () => true);
    onInvoke('burn_list_recorders', () => [RECORDER]);
    onInvoke('burn_media_state', () => token);
    onInvoke('burn_probe_media', () => {
      probes += 1;
      return media;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('picks up a disc put in while the page is open', async () => {
    const { result } = renderHook(() => useBurnRecorders());
    await settle();

    expect(result.current.selectedId).toBe('drive-1');
    expect(result.current.media?.present).toBe(false);

    token = 'cdr-blank';
    media = BLANK_CDR;
    await settle(POLL_MS);

    expect(result.current.media?.present).toBe(true);
    expect(result.current.media?.mediaType).toBe('CD-R');
    expect(result.current.media?.capacitySectors).toBe(359_849);
  });

  it('picks up a disc taken back out', async () => {
    token = 'cdr-blank';
    media = BLANK_CDR;
    const { result } = renderHook(() => useBurnRecorders());
    await settle();

    expect(result.current.media?.present).toBe(true);

    token = 'tray-empty';
    media = EMPTY_TRAY;
    await settle(POLL_MS);

    expect(result.current.media?.present).toBe(false);
  });

  it('leaves the drive alone while the fingerprint is unchanged', async () => {
    renderHook(() => useBurnRecorders());
    await settle();
    expect(probes).toBe(1);

    // The first tick only establishes the baseline, and the ticks after it
    // match it. Re-probing on either would make ATIP and TOC reads a
    // three-second habit, which is the whole reason the fingerprint exists.
    await settle(POLL_MS * 3);
    expect(probes).toBe(1);
  });

  it('stands down while a burn holds the drive', async () => {
    const fingerprint = vi.fn(() => token);
    onInvoke('burn_media_state', fingerprint);

    renderHook(() => useBurnRecorders(true));
    await settle(POLL_MS * 2);

    expect(fingerprint).not.toHaveBeenCalled();
  });
});

describe('useBurnRecorders drive discovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetBurnSupportForTest();
    onInvoke('burn_is_supported', () => true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports why the drive list is empty when enumeration fails', async () => {
    onInvoke('burn_list_recorders', () => {
      throw new Error('no MMC device answered');
    });

    const { result } = renderHook(() => useBurnRecorders());
    await settle();

    // Without this the picker is empty and says nothing, which reads as "this
    // machine has no burner" rather than "asking the machine went wrong".
    expect(result.current.recorders).toEqual([]);
    expect(result.current.error).toBe('no MMC device answered');
    expect(result.current.loading).toBe(false);
  });

  it('clears a past failure once the drives answer again', async () => {
    let failing = true;
    onInvoke('burn_list_recorders', () => {
      if (failing) throw new Error('no MMC device answered');
      return [RECORDER];
    });

    const { result } = renderHook(() => useBurnRecorders());
    await settle();
    expect(result.current.error).toBe('no MMC device answered');

    failing = false;
    act(() => result.current.refresh());
    await settle();

    expect(result.current.error).toBeNull();
    expect(result.current.recorders).toHaveLength(1);
  });
});
