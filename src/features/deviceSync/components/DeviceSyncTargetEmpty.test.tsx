import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import i18n from '@/lib/i18n';
import DeviceSyncTargetEmpty from './DeviceSyncTargetEmpty';

describe('DeviceSyncTargetEmpty', () => {
  it('leads to both ways of choosing a target', () => {
    const refreshDrives = vi.fn(async () => {});
    const handleChooseFolder = vi.fn(async () => {});
    renderWithProviders(
      <DeviceSyncTargetEmpty
        drivesLoading={false}
        isRunning={false}
        refreshDrives={refreshDrives}
        handleChooseFolder={handleChooseFolder}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: i18n.t('deviceSync.emptyTargetFind') }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('deviceSync.emptyTargetFolder') }));
    expect(refreshDrives).toHaveBeenCalled();
    expect(handleChooseFolder).toHaveBeenCalled();
  });
});
