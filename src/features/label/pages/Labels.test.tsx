import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation, useParams } from 'react-router';

import { ndClearTokenCache } from '@/lib/api/navidromeBrowse';
import { useAuthStore } from '@/store/authStore';
import { makeServer } from '@/test/helpers/factories';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { onInvoke } from '@/test/mocks/tauri';

import Labels from './Labels';

function LabelRouteProbe() {
  const { name } = useParams<{ name: string }>();
  const { search } = useLocation();
  return <div>Label detail: {name ?? ''} {search}</div>;
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

describe('Labels', () => {
  beforeEach(() => {
    resetAuthStore();
    ndClearTokenCache();
    const server = makeServer({ id: 's1' });
    useAuthStore.setState({ servers: [server], activeServerId: server.id });
    onInvoke('navidrome_login', () => ({ token: 'jwt', userId: 'u', isAdmin: false }));
  });

  it('groups labels by letter, cleans names and shows the count', async () => {
    onInvoke('nd_list_tags', () => [
      { id: 't1', tagName: 'recordlabel', tagValue: 'Warp' },
      { id: 't2', tagName: 'recordlabel', tagValue: '4AD' },
      { id: 't3', tagName: 'recordlabel', tagValue: ' Acid' },
    ]);

    renderLabels();

    expect(await screen.findByRole('button', { name: 'Warp' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acid' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '#' })).toBeInTheDocument();
    expect(screen.getByText(/3\s+Labels/)).toBeInTheDocument();
  });

  it('filters the list as the user types', async () => {
    onInvoke('nd_list_tags', () => [
      { id: 't1', tagName: 'recordlabel', tagValue: 'Warp' },
      { id: 't2', tagName: 'recordlabel', tagValue: '4AD' },
    ]);

    renderLabels();
    await screen.findByRole('button', { name: 'Warp' });
    await userEvent.type(screen.getByRole('searchbox'), 'wa');

    expect(screen.getByRole('button', { name: 'Warp' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '4AD' })).not.toBeInTheDocument();
  });

  it('opens the label page with the tag id and server', async () => {
    onInvoke('nd_list_tags', () => [{ id: 't1', tagName: 'recordlabel', tagValue: 'Warp' }]);

    renderLabels();
    await userEvent.click(await screen.findByRole('button', { name: 'Warp' }));

    expect(await screen.findByText(/Label detail: Warp \?id=t1&server=s1/)).toBeInTheDocument();
  });

  it('explains that the server does not support label browsing', async () => {
    onInvoke('nd_list_tags', () => { throw new Error('HTTP 404 Not Found'); });

    renderLabels();

    expect(await screen.findByText(/needs a Navidrome server/)).toBeInTheDocument();
  });
});
