import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import type { SubsonicPlaylist } from '@/lib/api/subsonicTypes';
import { usePlaylistStore } from '@/features/playlist';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';
import { PlaylistTargetList } from './PlaylistTargetList';

const playlist = (name: string): SubsonicPlaylist => ({
  id: name.toLowerCase(), name, songCount: 0, duration: 0, created: '', changed: '', serverId: 'srv',
});
const targets = ['Gamma', 'Alpha', 'Delta', 'Beta', 'Zeta', 'Epsilon'].map(playlist);

function rowNames(): string[] {
  return Array.from(document.querySelectorAll('.context-menu-item')).map(row => row.textContent ?? '');
}

beforeEach(() => {
  usePlaylistStore.setState({
    recentIds: [ownedEntityKey(playlist('Zeta')), ownedEntityKey(playlist('Beta'))],
  });
});

describe('PlaylistTargetList', () => {
  it('shows the recently used targets above the full alphabetical list', () => {
    renderWithProviders(<PlaylistTargetList targets={targets} serverId="srv" emptyLabel="none" onPick={vi.fn()} />);
    expect(screen.getByText('Recently used')).toBeInTheDocument();
    expect(rowNames()).toEqual(['Zeta', 'Beta', 'Alpha', 'Beta', 'Delta', 'Epsilon', 'Gamma', 'Zeta']);
  });

  it('picks the playlist from either section and keeps the list inert while one is written', () => {
    const onPick = vi.fn();
    const { rerender } = renderWithProviders(
      <PlaylistTargetList targets={targets} serverId="srv" emptyLabel="none" onPick={onPick} />,
    );
    fireEvent.click(screen.getAllByText('Zeta')[0]);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name: 'Zeta' }));

    rerender(
      <PlaylistTargetList targets={targets} serverId="srv" emptyLabel="none" busyKey={ownedEntityKey(playlist('Zeta'))} onPick={onPick} />,
    );
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.context-menu-item'));
    expect(rows.every(row => row.style.pointerEvents === 'none')).toBe(true);
  });

  it('shows only the empty label without targets', () => {
    renderWithProviders(<PlaylistTargetList targets={[]} serverId="srv" emptyLabel="No playlists yet." onPick={vi.fn()} />);
    expect(screen.getByText('No playlists yet.')).toBeInTheDocument();
    expect(screen.queryByText('Recently used')).toBeNull();
  });
});
