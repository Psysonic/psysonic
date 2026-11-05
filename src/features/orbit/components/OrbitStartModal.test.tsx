import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { makeServer } from '@/test/helpers/factories';
import { useAuthStore } from '@/store/authStore';
import {
  resetServerReachabilitySnapshot,
  setServerReachability,
} from '@/lib/network/serverReachability';

const mocks = vi.hoisted(() => ({
  startOrbitSession: vi.fn(),
}));
let secondServerId = '';

vi.mock('@/features/orbit/utils/orbit', () => ({
  buildOrbitShareLink: (serverBase: string, sid: string) => `psysonic2-orbit:${serverBase}:${sid}`,
  generateSessionId: () => 'session-id',
  startOrbitSession: mocks.startOrbitSession,
}));
vi.mock('@/features/orbit/utils/orbitNames', () => ({
  randomOrbitSessionName: () => 'Test Orbit',
}));

import OrbitStartModal from '@/features/orbit/components/OrbitStartModal';

beforeEach(() => {
  resetAuthStore();
  resetServerReachabilitySnapshot();
  mocks.startOrbitSession.mockReset().mockResolvedValue({});
  const first = makeServer({ id: 'srv-a', name: 'Server A', url: 'https://a.example' });
  const second = makeServer({ id: 'srv-b', name: 'Server B', url: 'https://b.example' });
  secondServerId = second.id;
  useAuthStore.setState({
    servers: [first, second],
    activeServerId: first.id,
    libraryBrowseServerIds: [first.id, second.id],
  });
});

describe('OrbitStartModal', () => {
  it('starts Orbit on the server selected from the current library scope', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrbitStartModal onClose={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: 'Server B' }));
    await user.click(screen.getByRole('button', { name: 'Copy link & start' }));

    expect(mocks.startOrbitSession).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Test Orbit',
      sid: 'session-id',
      serverId: 'srv-b',
      clearQueue: false,
    }));
  });

  it('starts with the automatic reshuffle off on a fresh profile', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrbitStartModal onClose={vi.fn()} />);

    expect(screen.getByRole('checkbox', { name: /Automatic reshuffle/ })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Copy link & start' }));

    expect(mocks.startOrbitSession).toHaveBeenCalledWith(expect.objectContaining({ autoShuffle: false }));
    expect(useAuthStore.getState().orbitStartAutoShuffle).toBe(false);
  });

  it('starts with the reshuffle on when switched on, and remembers it for the next session', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<OrbitStartModal onClose={vi.fn()} />);

    await user.click(screen.getByRole('checkbox', { name: /Automatic reshuffle/ }));
    await user.click(screen.getByRole('button', { name: 'Copy link & start' }));

    expect(mocks.startOrbitSession).toHaveBeenCalledWith(expect.objectContaining({ autoShuffle: true }));
    expect(useAuthStore.getState().orbitStartAutoShuffle).toBe(true);

    unmount();
    renderWithProviders(<OrbitStartModal onClose={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: /Automatic reshuffle/ })).toBeChecked();
  });

  it('keeps the remembered choice when the start fails', async () => {
    mocks.startOrbitSession.mockRejectedValueOnce(new Error('start failed'));
    const user = userEvent.setup();
    renderWithProviders(<OrbitStartModal onClose={vi.fn()} />);

    await user.click(screen.getByRole('checkbox', { name: /Automatic reshuffle/ }));
    await user.click(screen.getByRole('button', { name: 'Copy link & start' }));

    expect(await screen.findByText('start failed')).toBeInTheDocument();
    expect(useAuthStore.getState().orbitStartAutoShuffle).toBe(false);
  });

  it('shows unavailable servers with a warning and no empty checkbox squares', () => {
    setServerReachability(secondServerId, 'unavailable');

    const { container } = renderWithProviders(<OrbitStartModal onClose={vi.fn()} />);

    const unavailable = screen.getByRole('radio', { name: /Server B.*Cannot reach Server B/ });
    expect(unavailable.querySelector('.server-choice-warning')).toHaveAttribute(
      'data-tooltip',
      'Cannot reach Server B. Check your network or server.',
    );
    expect(container.querySelector('.nav-library-dropdown-item-toggle-box')).toBeNull();
  });
});
