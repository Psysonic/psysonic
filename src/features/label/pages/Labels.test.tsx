import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useParams } from 'react-router';

import { useAuthStore } from '@/store/authStore';
import { makeServer } from '@/test/helpers/factories';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { onInvoke } from '@/test/mocks/tauri';

import Labels from './Labels';

function LabelRouteProbe() {
  const { name } = useParams<{ name: string }>();
  return <div>Label detail: {name ?? ''}</div>;
}

function renderLabels() {
  return renderWithProviders(
    <Routes>
      <Route path="/labels" element={<Labels />} />
      <Route path="/label/:name" element={<LabelRouteProbe />} />
    </Routes>,
    { route: '/labels' },
  );
}

const row = (value: string, albumCount: number) => ({ value, albumCount, songCount: albumCount * 10 });

describe('Labels', () => {
  beforeEach(() => {
    resetAuthStore();
    const server = makeServer({ id: 's1', url: 'https://one.test' });
    useAuthStore.setState({ servers: [server], activeServerId: server.id });
  });

  it('groups labels from the local index by letter and shows the count', async () => {
    onInvoke('library_get_label_album_counts', () => [row('Warp', 12), row('4AD', 3), row('Acid', 1)]);
    renderLabels();

    expect(await screen.findByRole('button', { name: 'Warp' })).toHaveAttribute('data-tooltip', '12 albums');
    expect(screen.getByRole('heading', { level: 2, name: '#' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'A' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Labels' }).parentElement).toHaveTextContent('3 Labels');
  });

  it('passes the selected libraries as the index scope', async () => {
    useAuthStore.setState({ libraryBrowseSelectionByServer: { s1: ['lib-2'] } });
    let scopes: unknown = null;
    onInvoke('library_get_label_album_counts', args => {
      scopes = (args as { libraryScopes: unknown }).libraryScopes;
      return [row('Warp', 1)];
    });
    renderLabels();

    await screen.findByRole('button', { name: 'Warp' });
    expect(scopes).toEqual(['lib-2']);
  });

  it('merges labels across every server in the browse scope', async () => {
    const second = makeServer({ id: 's2', url: 'https://two.test' });
    useAuthStore.setState(s => ({ servers: [...s.servers, second], libraryBrowseServerIds: ['s1', 's2'] }));
    onInvoke('library_get_label_album_counts', args => (
      String((args as { serverId: string }).serverId).includes('two')
        ? [row('warp', 2), row('Bleep', 1)]
        : [row('Warp', 3)]
    ));
    renderLabels();

    expect(await screen.findByRole('button', { name: 'Warp' })).toHaveAttribute('data-tooltip', '5 albums');
    expect(screen.getByRole('button', { name: 'Bleep' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'warp' })).not.toBeInTheDocument();
  });

  it('filters labels and opens a label page', async () => {
    onInvoke('library_get_label_album_counts', () => [row('Warp', 1), row('Bleep', 1)]);
    renderLabels();
    const user = userEvent.setup();

    await user.type(await screen.findByRole('searchbox'), 'ble');
    expect(screen.queryByRole('button', { name: 'Warp' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Bleep' }));
    expect(await screen.findByText('Label detail: Bleep')).toBeInTheDocument();
  });

  it('says so when the index has no labels', async () => {
    onInvoke('library_get_label_album_counts', () => []);
    renderLabels();
    expect(await screen.findByText('No record labels found.')).toBeInTheDocument();
  });
});
