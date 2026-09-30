import { type MouseEvent } from 'react';
import { open } from '@tauri-apps/plugin-shell';
import { useTranslation } from 'react-i18next';
import { showToast } from '@/lib/dom/toast';

// Comments are plain text, but servers may also store Markdown-style links.
// Never render server-provided HTML or allow non-web schemes through the shell.
const linkPattern = /\[([^\]\n]+)\]\((https?:\/\/[^\s<>)]+)\)|(https?:\/\/[^\s<>"']+)/gi;

function webUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function trimUrlPunctuation(value: string): string {
  let url = value.replace(/[.,!?;:]+$/, '');
  while (url.endsWith(')') && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)) {
    url = url.slice(0, -1);
  }
  return url.replace(/[.,!?;:]+$/, '');
}

export default function PlaylistCommentLinks({ comment }: { comment: string }) {
  const { t } = useTranslation();

  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of comment.matchAll(linkPattern)) {
    const start = match.index;
    if (start > last) parts.push(comment.slice(last, start));
    const raw = match[0];
    const markdown = match[2] !== undefined;
    const candidate = match[2] ?? match[3];
    const trimmed = markdown ? candidate : trimUrlPunctuation(candidate);
    const url = webUrl(trimmed);
    if (url) {
      const openLink = (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        void open(url).catch(() => showToast(t('playlists.linkOpenError'), 4000, 'error'));
      };
      parts.push(
        <a
          key={start}
          href={url}
          className="playlist-comment-link"
          onClick={openLink}
          onAuxClick={event => {
            if (event.button === 1) openLink(event);
          }}
        >
          {markdown ? match[1] : trimmed}
        </a>,
      );
      if (!markdown && trimmed.length < raw.length) parts.push(raw.slice(trimmed.length));
    } else {
      parts.push(raw);
    }
    last = start + raw.length;
  }
  if (last < comment.length) parts.push(comment.slice(last));

  return <div className="playlist-comment">{parts}</div>;
}
