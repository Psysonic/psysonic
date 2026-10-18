import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n';
import { useConfirmModalStore } from '@/store/confirmModalStore';
import { useOrbitStore } from '@/features/orbit/store/orbitStore';
import { resetOrbitStore } from '@/test/helpers/storeReset';
import { orbitBulkGuard } from './orbitBulkGuard';

const request = vi.fn(async () => true);
const originalRequest = useConfirmModalStore.getState().request;

beforeEach(async () => {
  resetOrbitStore();
  request.mockClear();
  useConfirmModalStore.setState({ request });
  await i18n.changeLanguage('en');
});

afterEach(() => {
  useConfirmModalStore.setState({ request: originalRequest });
});

describe('orbitBulkGuard wording', () => {
  it('asks an active guest whether to suggest the tracks to the host', async () => {
    useOrbitStore.setState({ role: 'guest', phase: 'active' });
    await orbitBulkGuard(12);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      title: i18n.t('orbit.bulkConfirmGuestTitle'),
      message: i18n.t('orbit.bulkConfirmGuestBody', { count: 12 }),
      confirmLabel: i18n.t('orbit.bulkConfirmGuestYes'),
    }));
    expect(i18n.t('orbit.bulkConfirmGuestBody', { count: 12 })).toContain('12');
  });

  it('keeps the shared-queue question for the host', async () => {
    useOrbitStore.setState({ role: 'host', phase: 'active' });
    await orbitBulkGuard(12);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      title: i18n.t('orbit.bulkConfirmTitle'),
      confirmLabel: i18n.t('orbit.bulkConfirmYes'),
    }));
  });
});
