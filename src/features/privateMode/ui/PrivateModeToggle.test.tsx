import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAllStores } from '@/test/helpers/storeReset';
import PrivateModeToggle from './PrivateModeToggle';
import { isPrivateModeActive, usePrivateModeStore } from '../privateModeStore';

beforeEach(() => {
  resetAllStores();
});

describe('PrivateModeToggle', () => {
  it('starts off and switches private mode on and off', () => {
    const { getByRole } = renderWithProviders(<PrivateModeToggle />);
    const button = getByRole('button', { name: 'Private mode' });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(button);
    expect(isPrivateModeActive()).toBe(true);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveClass('private-mode-toggle--active');

    fireEvent.click(button);
    expect(isPrivateModeActive()).toBe(false);
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('describes what the switch does in each state', () => {
    const { getByRole } = renderWithProviders(<PrivateModeToggle />);
    const button = getByRole('button', { name: 'Private mode' });
    expect(button.getAttribute('data-tooltip')).toMatch(/^Private mode: no scrobbles/);

    act(() => usePrivateModeStore.getState().setActive(true));
    expect(button.getAttribute('data-tooltip')).toMatch(/^Private mode is on/);
  });
});
