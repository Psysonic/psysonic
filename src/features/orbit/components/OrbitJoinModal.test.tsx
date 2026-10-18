import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { makeServer } from '@/test/helpers/factories';
import { useAuthStore } from '@/store/authStore';
import { OrbitJoinError } from '@/features/orbit/utils/guest';

const mocks = vi.hoisted(() => ({
  joinOrbitSession: vi.fn(),
}));

vi.mock('@/features/orbit/utils/orbit', async importOriginal => ({
  ...(await importOriginal<typeof import('@/features/orbit/utils/orbit')>()),
  parseOrbitShareLink: () => ({ sid: 'abc123', serverBase: 'https://a.example' }),
  findSessionPlaylistId: async () => 'session-playlist',
  readOrbitState: async () => ({ ended: false }),
  joinOrbitSession: mocks.joinOrbitSession,
}));

import OrbitJoinModal from '@/features/orbit/components/OrbitJoinModal';

beforeEach(() => {
  resetAuthStore();
  mocks.joinOrbitSession.mockReset();
  const server = makeServer({ id: 'srv-a', url: 'https://a.example' });
  useAuthStore.setState({ servers: [server], activeServerId: server.id });
});

async function submitJoin() {
  const user = userEvent.setup();
  renderWithProviders(<OrbitJoinModal onClose={vi.fn()} />, { language: 'de' });
  await user.type(screen.getByRole('textbox', { name: 'Einladungslink' }), 'invite');
  await user.click(screen.getByRole('button', { name: 'Beitreten' }));
}

describe('OrbitJoinModal join errors', () => {
  it('shows the translated reason when joining fails', async () => {
    mocks.joinOrbitSession.mockRejectedValue(
      new OrbitJoinError('full', 'Session abc123 is full (10/10)'),
    );
    await submitJoin();
    expect(await screen.findByText('Session ist voll')).toBeInTheDocument();
    expect(screen.queryByText(/is full/)).not.toBeInTheDocument();
  });

  it('shows the generic translated failure for other errors', async () => {
    mocks.joinOrbitSession.mockRejectedValue(new Error('socket hang up'));
    await submitJoin();
    expect(await screen.findByText('Session konnte nicht beigetreten werden')).toBeInTheDocument();
    expect(screen.queryByText('socket hang up')).not.toBeInTheDocument();
  });
});
