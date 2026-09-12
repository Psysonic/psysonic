import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onInvoke } from '@/test/mocks/tauri';
import * as burnApi from '@/lib/api/burn';
import {
  _resetBurnSupportForTest,
  primeBurnSupport,
  useBurnSupportStore,
} from './burnSupportStore';

/** Let the probe's promise chain settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('burnSupportStore', () => {
  beforeEach(() => {
    _resetBurnSupportForTest();
  });

  it('starts out unknown, so nothing renders on a guess', () => {
    expect(useBurnSupportStore.getState().supported).toBe('unknown');
  });

  it('records a backend that reports support', async () => {
    onInvoke('burn_is_supported', () => true);
    primeBurnSupport();
    await settle();
    expect(useBurnSupportStore.getState().supported).toBe('yes');
  });

  it('records a build with no burn backend', async () => {
    onInvoke('burn_is_supported', () => false);
    primeBurnSupport();
    await settle();
    expect(useBurnSupportStore.getState().supported).toBe('no');
  });

  it('asks the backend once however many callers prime it', async () => {
    const probe = vi.fn(() => true);
    onInvoke('burn_is_supported', probe);
    primeBurnSupport();
    primeBurnSupport();
    await settle();
    primeBurnSupport();
    await settle();

    expect(probe).toHaveBeenCalledTimes(1);
    expect(useBurnSupportStore.getState().supported).toBe('yes');
  });

  it('settles on "no" when the binding hands back nothing at all', async () => {
    // A bare `vi.fn()` invoke — the shape a test gets when it renders a
    // burner-aware component without installing the Tauri harness. Calling
    // `.then` on the undefined it returns used to throw out of the effect.
    const bare = vi.spyOn(burnApi, 'burnIsSupported').mockReturnValue(undefined as never);
    primeBurnSupport();
    await settle();
    expect(useBurnSupportStore.getState().supported).toBe('no');
    bare.mockRestore();
  });

  it('settles on "no" when there is no IPC host to answer', async () => {
    // No onInvoke registration: the harness rejects unhandled commands, the
    // same shape as running outside Tauri. Leaving this at "unknown" would
    // strand every caller waiting.
    primeBurnSupport();
    await settle();
    expect(useBurnSupportStore.getState().supported).toBe('no');
  });
});
