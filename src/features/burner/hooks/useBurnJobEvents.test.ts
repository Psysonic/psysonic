/**
 * useBurnJobEvents — the CD-TEXT outcome a user is told about.
 *
 * A burn can ask for CD-TEXT and come back without it: the drive can refuse the
 * setup, or the write can report success while never reaching the disc and be
 * redone without CD-TEXT. The disc plays either way, and that is exactly why
 * the missing track names have to be said out loud rather than discovered in a
 * player.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { emitTauriEvent } from '@/test/mocks/tauri';
import i18n from '@/lib/i18n';
import { showToast } from '@/lib/dom/toast';
import { useBurnJobStore } from '@/features/burner/store/burnJobStore';
import { useBurnJobEvents } from '@/features/burner/hooks/useBurnJobEvents';

vi.mock('@/lib/dom/toast', () => ({ showToast: vi.fn() }));

function mount() {
  renderHook(() => useBurnJobEvents());
}

function complete(overrides: Record<string, unknown> = {}) {
  emitTauriEvent('burn:complete', {
    jobId: 'job-1',
    cancelled: false,
    tracksWritten: 12,
    sectorsWritten: 166_398,
    error: null,
    testWrite: false,
    cdTextWritten: false,
    cdTextVerification: null,
    ...overrides,
  });
}

const skippedNotice = () => i18n.t('burner.toastCdTextSkipped');
const toastTexts = () => vi.mocked(showToast).mock.calls.map(call => call[0]);

beforeEach(() => {
  vi.mocked(showToast).mockClear();
  useBurnJobStore.getState().reset();
});

describe('useBurnJobEvents — CD-TEXT that did not make it onto the disc', () => {
  it('says so when CD-TEXT was asked for and the disc came back without it', () => {
    useBurnJobStore.getState().start('job-1', 166_398, false, true);
    mount();

    complete({ cdTextWritten: false });

    expect(toastTexts()).toContain(skippedNotice());
  });

  it('stays quiet when CD-TEXT was asked for and written', () => {
    useBurnJobStore.getState().start('job-1', 166_398, false, true);
    mount();

    complete({ cdTextWritten: true, cdTextVerification: { checked: true, packs: 40, error: null } });

    expect(toastTexts()).not.toContain(skippedNotice());
  });

  it('stays quiet when CD-TEXT was never asked for', () => {
    useBurnJobStore.getState().start('job-1', 166_398, false, false);
    mount();

    complete({ cdTextWritten: false });

    expect(toastTexts()).not.toContain(skippedNotice());
  });

  it('says nothing about CD-TEXT after a rehearsal, which writes nothing by design', () => {
    useBurnJobStore.getState().start('job-1', 166_398, true, true);
    mount();

    complete({ testWrite: true, cdTextWritten: false });

    expect(toastTexts()).not.toContain(skippedNotice());
  });
});
