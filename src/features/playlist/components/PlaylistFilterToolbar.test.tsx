import type React from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PlaylistFilterToolbar from '@/features/playlist/components/PlaylistFilterToolbar';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';

describe('PlaylistFilterToolbar default order', () => {
  it('represents natural sort as ID and keeps date-added separate', async () => {
    const user = userEvent.setup();
    const setSortKey = vi.fn();
    const setSortDir = vi.fn();
    const view = renderWithProviders(
      <PlaylistFilterToolbar
        filterText=""
        setFilterText={vi.fn()}
        sortKey="natural"
        sortDir="asc"
        setSortKey={setSortKey}
        setSortDir={setSortDir}
        setSortClickCount={vi.fn()}
      />,
    );

    await user.click(view.getByRole('button', { name: 'Sort tracks' }));
    expect(view.getByRole('option', { name: 'ID' })).toBeInTheDocument();
    expect(view.getByRole('option', { name: 'Date added (newest)' })).toBeInTheDocument();
    expect(view.getByRole('option', { name: 'Date added (oldest)' })).toBeInTheDocument();

    await user.click(view.getByRole('option', { name: 'Date added (oldest)' }));
    expect(setSortKey).toHaveBeenCalledWith('position');
    expect(setSortDir).toHaveBeenCalledWith('asc');
  });

  it('maps the default option back to natural order', async () => {
    const user = userEvent.setup();
    const setSortKey = vi.fn();
    const setSortDir = vi.fn();
    const view = renderWithProviders(
      <PlaylistFilterToolbar
        filterText=""
        setFilterText={vi.fn()}
        sortKey="position"
        sortDir="desc"
        setSortKey={setSortKey}
        setSortDir={setSortDir}
        setSortClickCount={vi.fn()}
      />,
    );

    await user.click(view.getByRole('button', { name: 'Sort tracks' }));
    await user.click(view.getByRole('option', { name: 'ID' }));
    expect(setSortKey).toHaveBeenCalledWith('natural');
    expect(setSortDir).toHaveBeenCalledWith('asc');
  });
});

describe('PlaylistFilterToolbar reorder hint', () => {
  const HINT = 'Drag to reorder works only with the sort “ID” and no filter.';

  function renderToolbar(over: Partial<React.ComponentProps<typeof PlaylistFilterToolbar>> = {}) {
    const props = {
      filterText: '',
      setFilterText: vi.fn(),
      sortKey: 'natural' as const,
      sortDir: 'asc' as const,
      setSortKey: vi.fn(),
      setSortDir: vi.fn(),
      setSortClickCount: vi.fn(),
      canReorder: true,
      ...over,
    };
    return { view: renderWithProviders(<PlaylistFilterToolbar {...props} />), props };
  }

  it('stays hidden in ID order without a filter', () => {
    const { view } = renderToolbar();
    expect(view.queryByText(HINT)).not.toBeInTheDocument();
  });

  it('shows while a sort is active', () => {
    expect(renderToolbar({ sortKey: 'title' }).view.getByText(HINT)).toBeInTheDocument();
  });

  it('shows while only a filter is active', () => {
    expect(renderToolbar({ filterText: 'love' }).view.getByText(HINT)).toBeInTheDocument();
  });

  it('stays hidden for playlists that cannot be reordered', () => {
    const { view } = renderToolbar({ sortKey: 'title', canReorder: false });
    expect(view.queryByText(HINT)).not.toBeInTheDocument();
  });

  it('resets sort and filter back to the reorderable view', async () => {
    const user = userEvent.setup();
    const { view, props } = renderToolbar({ sortKey: 'rating', sortDir: 'desc', filterText: 'love' });
    await user.click(view.getByRole('button', { name: 'Reset' }));
    expect(props.setFilterText).toHaveBeenCalledWith('');
    expect(props.setSortKey).toHaveBeenCalledWith('natural');
    expect(props.setSortDir).toHaveBeenCalledWith('asc');
  });
});
