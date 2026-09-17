import type { ReactNode } from 'react';
import { Music } from 'lucide-react';
import { formatTrackTime } from '@/lib/format/formatDuration';
import OverlayScrollArea from '@/ui/OverlayScrollArea';

export interface ShareTrackListItem {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration: number;
  number: number;
  cover?: ReactNode;
}

interface ShareTrackListProps {
  items: ShareTrackListItem[];
}

export default function ShareTrackList({ items }: ShareTrackListProps) {
  return (
    <OverlayScrollArea
      className="shared-contents-modal__list-wrap"
      viewportClassName="shared-contents-modal__list-viewport"
      measureDeps={[items.length]}
      railInset="panel"
    >
      <ol className="shared-contents-modal__list">
        {items.map(item => (
          <li className="shared-contents-modal__track" key={item.id}>
            {item.cover ?? (
              <span className="shared-contents-modal__fallback" aria-hidden="true"><Music size={16} /></span>
            )}
            <span className="shared-contents-modal__number">{item.number}</span>
            <span className="shared-contents-modal__meta">
              <strong>{item.title}</strong>
              <span>{[item.artist, item.album].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="shared-contents-modal__duration">
              {item.duration > 0 ? formatTrackTime(item.duration) : ''}
            </span>
          </li>
        ))}
      </ol>
    </OverlayScrollArea>
  );
}
