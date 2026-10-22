import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { libraryResolveEntitySources, type LibraryEntitySourceDto } from '@/lib/api/library';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import EntitySourcePicker from '@/ui/EntitySourcePicker';

vi.mock('@/lib/api/library', () => ({
  libraryResolveEntitySources: vi.fn(),
}));

const resolveSources = vi.mocked(libraryResolveEntitySources);

const currentSource: LibraryEntitySourceDto = {
  serverId: 'server-a',
  id: 'album-a',
  libraryId: 'music-a',
  priority: 0,
  durationSec: null,
  suffix: null,
  bitRate: null,
  sizeBytes: null,
  starredAt: null,
  userRating: null,
};

const alternateSource: LibraryEntitySourceDto = {
  ...currentSource,
  serverId: 'server-b',
  id: 'album-b',
  libraryId: 'music-b',
  priority: 1,
};

function props(onSelect = vi.fn()) {
  return {
    entityType: 'album' as const,
    anchorServerId: 'server-a',
    anchorId: 'album-a',
    scopes: [
      { serverId: 'server-a', libraryId: 'music-a' },
      { serverId: 'server-b', libraryId: 'music-b' },
    ],
    servers: [
      { id: 'server-a', name: 'Primary', url: 'https://a.test', username: 'alice', password: 'secret' },
      { id: 'server-b', name: 'Archive', url: 'https://b.test', username: 'bob', password: 'secret' },
    ],
    musicFoldersByServer: {
      'server-a': [{ id: 'music-a', name: 'Main library' }],
      'server-b': [{ id: 'music-b', name: 'Lossless' }],
    },
    onSelect,
  };
}

beforeEach(() => {
  resolveSources.mockReset();
});

describe('EntitySourcePicker', () => {
  it('stays hidden when the entity has only one concrete source', async () => {
    resolveSources.mockResolvedValue([currentSource]);

    renderWithProviders(<EntitySourcePicker {...props()} />);

    await waitFor(() => expect(resolveSources).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: /available from/i })).not.toBeInTheDocument();
  });

  it('does not offer a sibling from the same server and library', async () => {
    // Issue #1711: two album ids in one library share a key. Opening the other
    // one renders the same merged page, so it is not a source to switch to.
    const sameLibrarySibling = { ...currentSource, id: 'album-a-split', priority: 0 };
    resolveSources.mockResolvedValue([currentSource, sameLibrarySibling]);

    renderWithProviders(<EntitySourcePicker {...props()} />);

    await waitFor(() => expect(resolveSources).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: /available from/i })).not.toBeInTheDocument();
  });

  it('keeps copies on other servers or in other libraries next to a same-library sibling', async () => {
    const sameLibrarySibling = { ...currentSource, id: 'album-a-split', priority: 0 };
    const otherLibrarySameServer = {
      ...currentSource,
      id: 'album-a-lossless',
      libraryId: 'music-a-lossless',
      priority: 1,
    };
    resolveSources.mockResolvedValue([
      currentSource,
      sameLibrarySibling,
      otherLibrarySameServer,
      alternateSource,
    ]);
    const user = userEvent.setup();
    renderWithProviders(<EntitySourcePicker {...props()} />);

    await user.click(await screen.findByRole('button', { name: 'Available from 3 sources' }));

    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(3);
    expect(screen.getByText('Primary · music-a-lossless')).toBeInTheDocument();
    expect(screen.getByText('Archive · Lossless')).toBeInTheDocument();
  });

  it('lists labeled sources and selects only a concrete alternative', async () => {
    resolveSources.mockResolvedValue([currentSource, alternateSource]);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<EntitySourcePicker {...props(onSelect)} />);

    await user.click(await screen.findByRole('button', { name: 'Available from 2 sources' }));

    const current = screen.getByRole('menuitem', { name: /Primary · Main library.*Current source/ });
    const alternate = screen.getByRole('menuitem', { name: /Archive · Lossless.*Open from server/ });
    expect(current).toBeDisabled();
    expect(current).toHaveAttribute('aria-current', 'true');

    await user.click(alternate);

    expect(onSelect).toHaveBeenCalledWith(alternateSource);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('supports menu keyboard navigation and restores trigger focus on Escape', async () => {
    const thirdSource = {
      ...alternateSource,
      serverId: 'server-c',
      id: 'album-c',
      libraryId: 'unlisted-folder',
      priority: 2,
    };
    resolveSources.mockResolvedValue([currentSource, alternateSource, thirdSource]);
    const user = userEvent.setup();
    renderWithProviders(<EntitySourcePicker {...props()} />);

    const trigger = await screen.findByRole('button', { name: 'Available from 3 sources' });
    trigger.focus();
    await user.keyboard('{Enter}');

    const alternatives = screen.getAllByRole('menuitem').filter(item => !item.hasAttribute('disabled'));
    expect(alternatives[0]).toHaveFocus();
    expect(screen.getByText('server-c · unlisted-folder')).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(alternatives[1]).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
