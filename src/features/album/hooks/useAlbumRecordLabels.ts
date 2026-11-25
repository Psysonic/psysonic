import { useEffect, useState } from 'react';
import { fetchAlbumRecordLabels } from '@/lib/library/albumRecordLabels';

/**
 * Record labels for the album header. The server's own album label wins; album rows
 * from the local index carry none, so the labels then come from the album's tracks.
 */
export function useAlbumRecordLabels(
  serverLabel: string | undefined,
  serverId: string | null | undefined,
  albumId: string,
): string[] {
  const own = serverLabel?.trim() ?? '';
  const key = `${serverId ?? ''}\u001f${albumId}`;
  const [indexed, setIndexed] = useState<{ key: string; labels: string[] } | null>(null);

  useEffect(() => {
    if (own) return;
    let cancelled = false;
    void fetchAlbumRecordLabels(serverId, albumId).then(labels => {
      if (!cancelled) setIndexed({ key, labels });
    });
    return () => { cancelled = true; };
  }, [own, serverId, albumId, key]);

  if (own) return [own];
  return indexed?.key === key ? indexed.labels : [];
}
