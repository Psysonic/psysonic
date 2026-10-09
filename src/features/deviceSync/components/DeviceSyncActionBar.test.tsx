import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import i18n from '@/lib/i18n';
import DeviceSyncActionBar from './DeviceSyncActionBar';

function renderBar(overrides: Partial<React.ComponentProps<typeof DeviceSyncActionBar>> = {}) {
  const props = {
    syncedCount: 2,
    pendingCount: 3,
    deletionCount: 0,
    checkedCount: 0,
    isRunning: false,
    actionButtonLabel: 'Transfer',
    actionButtonDisabled: false,
    promptSyncSummary: vi.fn(async () => {}),
    handleMarkCheckedForDeletion: vi.fn(),
    jobStatus: 'idle' as const,
    jobDone: 0,
    jobSkip: 0,
    jobFail: 0,
    jobTotal: 0,
    ...overrides,
  };
  renderWithProviders(<DeviceSyncActionBar {...props} />);
  return props;
}

describe('DeviceSyncActionBar', () => {
  it('sums up the device and starts the sync', () => {
    const props = renderBar();
    expect(screen.getByText(new RegExp(`2 ${i18n.t('deviceSync.statusSynced')}`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`3 ${i18n.t('deviceSync.statusPending')}`))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Transfer' }));
    expect(props.promptSyncSummary).toHaveBeenCalled();
  });

  it('offers to remove the checked rows only while some are checked', () => {
    renderBar();
    const label = i18n.t('deviceSync.deleteFromDevice', { count: 2 });
    expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
  });

  it('marks the checked rows for deletion', () => {
    const props = renderBar({ checkedCount: 2 });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('deviceSync.deleteFromDevice', { count: 2 }) }));
    expect(props.handleMarkCheckedForDeletion).toHaveBeenCalled();
  });

  it('shows progress instead of the summary while a sync runs', () => {
    renderBar({ jobStatus: 'running', isRunning: true, jobDone: 4, jobTotal: 10 });
    expect(screen.getByText(i18n.t('deviceSync.syncInProgress', { done: 4, total: 10 }))).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(i18n.t('deviceSync.statusPending')))).not.toBeInTheDocument();
  });
});
