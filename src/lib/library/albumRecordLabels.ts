import { commands } from '@/generated/bindings';
import { librarySqlServerId } from '@/lib/api/coverCache';

/**
 * Record labels of one album from the local index, the label on most tracks first.
 * Index-only: the album rows the detail page gets carry no label, while `track_label`
 * does. Empty when the album is not indexed (yet) or its tracks carry no label tag.
 */
export async function fetchAlbumRecordLabels(
  serverId: string | null | undefined,
  albumId: string,
): Promise<string[]> {
  const id = albumId.trim();
  if (!serverId || !id) return [];
  try {
    const res = await commands.libraryAlbumRecordLabels(librarySqlServerId(serverId), id);
    return res.status === 'ok' ? res.data : [];
  } catch {
    return [];
  }
}
