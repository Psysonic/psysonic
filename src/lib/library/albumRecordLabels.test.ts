import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/generated/bindings', () => ({
  commands: { libraryAlbumRecordLabels: vi.fn() },
}));

vi.mock('@/lib/api/coverCache', () => ({
  librarySqlServerId: vi.fn((id: string) => `sql-${id}`),
}));

import { commands } from '@/generated/bindings';
import { fetchAlbumRecordLabels } from './albumRecordLabels';

const call = vi.mocked(commands.libraryAlbumRecordLabels);

describe('fetchAlbumRecordLabels', () => {
  beforeEach(() => { call.mockReset(); });

  it('asks the index with the SQL server key and returns its labels', async () => {
    call.mockResolvedValue({ status: 'ok', data: ['Atlantic', 'Warp'] });
    await expect(fetchAlbumRecordLabels('srv', ' al-1 ')).resolves.toEqual(['Atlantic', 'Warp']);
    expect(call).toHaveBeenCalledWith('sql-srv', 'al-1');
  });

  it('returns no labels when the index answers with an error or throws', async () => {
    call.mockResolvedValueOnce({ status: 'error', error: 'busy' });
    await expect(fetchAlbumRecordLabels('srv', 'al-1')).resolves.toEqual([]);
    call.mockRejectedValueOnce(new Error('ipc'));
    await expect(fetchAlbumRecordLabels('srv', 'al-1')).resolves.toEqual([]);
  });

  it('does not ask without a server or album', async () => {
    await expect(fetchAlbumRecordLabels(null, 'al-1')).resolves.toEqual([]);
    await expect(fetchAlbumRecordLabels('srv', '  ')).resolves.toEqual([]);
    expect(call).not.toHaveBeenCalled();
  });
});
