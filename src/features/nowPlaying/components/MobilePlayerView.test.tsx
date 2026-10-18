import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { makeTrack, seedQueue } from '@/test/helpers/factories';
import { resetPlayerStore } from '@/test/helpers/storeReset';
import { registerDefaultCoverInvokeHandlers } from '@/test/mocks/tauri';
import MobilePlayerView from './MobilePlayerView';

beforeEach(() => {
  resetPlayerStore();
  registerDefaultCoverInvokeHandlers();
});

describe('MobilePlayerView back button', () => {
  it('has a translated accessible name while nothing is playing', () => {
    renderWithProviders(<MobilePlayerView />, { language: 'de' });
    expect(screen.getByRole('button', { name: 'Zurück' })).toBeInTheDocument();
  });

  it('has a translated accessible name while a track is playing', () => {
    seedQueue([makeTrack()]);
    renderWithProviders(<MobilePlayerView />, { language: 'de' });
    expect(screen.getByRole('button', { name: 'Zurück' })).toBeInTheDocument();
  });
});
