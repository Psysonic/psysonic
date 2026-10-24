import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SortDropdown from './SortDropdown';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';

describe('SortDropdown keyboard navigation', () => {
  it('opens at the selection, moves and selects with the keyboard', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<SortDropdown value="popular" options={[{ value: 'popular', label: 'Popularity' }, { value: 'alpha', label: 'Alphabetical' }]} onChange={onChange} ariaLabel="Sort" />);
    const trigger = screen.getByRole('button', { name: 'Sort' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('option', { name: 'Popularity' })).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('alpha');
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}{End}');
    expect(screen.getByRole('option', { name: 'Alphabetical' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
