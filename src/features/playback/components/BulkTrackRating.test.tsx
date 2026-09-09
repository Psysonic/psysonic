import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { BulkTrackRating } from './BulkTrackRating';

const TWO_TRACKS = [
  { id: 'one', serverId: 'srv-a', userRating: 0 },
  { id: 'two', serverId: 'srv-a', userRating: 0 },
];

describe('BulkTrackRating', () => {
  it('rates every selected track through the row handler', async () => {
    const user = userEvent.setup();
    const onRate = vi.fn();
    renderWithProviders(<BulkTrackRating tracks={TWO_TRACKS} onRate={onRate} />);

    await user.click(screen.getAllByRole('radio')[3]);

    expect(onRate).toHaveBeenCalledTimes(2);
    expect(onRate).toHaveBeenCalledWith(TWO_TRACKS[0], 4);
    expect(onRate).toHaveBeenCalledWith(TWO_TRACKS[1], 4);
  });

  it('shows the shared rating when the selection agrees', () => {
    renderWithProviders(
      <BulkTrackRating
        tracks={[
          { id: 'one', serverId: 'srv-a', userRating: 3 },
          { id: 'two', serverId: 'srv-a', userRating: 3 },
        ]}
        onRate={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('radio').map(star => star.getAttribute('aria-checked')))
      .toEqual(['true', 'true', 'true', 'false', 'false']);
  });

  it('shows no rating when the selection disagrees, so a click is unambiguous', () => {
    renderWithProviders(
      <BulkTrackRating
        tracks={[
          { id: 'one', serverId: 'srv-a', userRating: 5 },
          { id: 'two', serverId: 'srv-a', userRating: 1 },
        ]}
        onRate={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('radio').every(star => star.getAttribute('aria-checked') === 'false'))
      .toBe(true);
  });

  it('keeps showing a fresh rating after the sync override is gone', () => {
    // The list's own map is what survives a successful server round-trip.
    renderWithProviders(
      <BulkTrackRating
        tracks={TWO_TRACKS}
        ratings={{ 'srv-a:one': 2, 'srv-a:two': 2 }}
        onRate={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('radio').map(star => star.getAttribute('aria-checked')))
      .toEqual(['true', 'true', 'false', 'false', 'false']);
  });

  it('renders nothing without a selection', () => {
    const { container } = renderWithProviders(<BulkTrackRating tracks={[]} onRate={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
