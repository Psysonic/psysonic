import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetOrbitStore, resetPlayerStore } from '@/test/helpers/storeReset';
import { makeInitialOrbitState } from '@/features/orbit/api/orbit';
import { useOrbitStore } from '@/features/orbit/store/orbitStore';
import OrbitSessionBar from './OrbitSessionBar';

beforeEach(() => {
  resetOrbitStore();
  resetPlayerStore();
  useOrbitStore.setState({
    state: makeInitialOrbitState({ sid: 'aaaa1111', host: 'tester', name: 'Test session', maxUsers: 10 }),
    role: 'host',
    phase: 'active',
    serverId: 'server-1',
  });
});

describe('OrbitSessionBar accessible names', () => {
  it('names the host settings button', () => {
    renderWithProviders(<OrbitSessionBar />, { language: 'de' });
    expect(screen.getByRole('button', { name: 'Session-Einstellungen' })).toBeInTheDocument();
  });

  it('names the participants button and keeps the count', () => {
    renderWithProviders(<OrbitSessionBar />, { language: 'de' });
    const button = screen.getByRole('button', { name: 'Teilnehmer: 1/10' });
    expect(button).toHaveTextContent('1/10');
  });
});
