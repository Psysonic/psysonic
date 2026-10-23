import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAllStores } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';
import { LibraryTab } from './LibraryTab';

describe('LibraryTab ratings', () => {
  beforeEach(resetAllStores);

  it('switches star ratings off and on', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LibraryTab />);
    const toggle = screen.getByRole('checkbox', { name: 'Show star ratings' });
    expect(toggle).toBeChecked();

    await user.click(toggle);
    expect(useAuthStore.getState().showStarRatings).toBe(false);
    await user.click(toggle);
    expect(useAuthStore.getState().showStarRatings).toBe(true);
  });
});
