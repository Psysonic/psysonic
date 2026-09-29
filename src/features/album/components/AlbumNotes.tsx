import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sanitizeHtml } from '@/lib/util/sanitizeHtml';

interface AlbumNotesProps {
  /** The album's comment tag, already agreed across tracks. */
  comment: string | null;
  /** The server's album description / review. May contain markup. */
  description: string | null;
}

/** Lines of the description shown before it is clamped. Mirrors `--album-notes-lines`. */
const CLAMPED_LINES = 2;

/**
 * The album's own words: the comment tag first, the server's description below.
 *
 * Order is deliberate. A comment is short and concrete ("Remaster 2024") while a
 * description runs to a paragraph; putting the paragraph first buries the one
 * line that is usually the reason someone tagged the release at all.
 *
 * The description is clamped to two lines with an inline expander rather than a
 * modal, so reading it never takes the album off screen.
 */
export default function AlbumNotes({ comment, description }: AlbumNotesProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [clamps, setClamps] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  // Whether the expander is needed at all is a layout question, so it is
  // measured rather than guessed from string length: the same text wraps to one
  // line on a wide window and three on a narrow one, and the font may still be
  // swapping when this first renders. Measured while clamped — once expanded,
  // scrollHeight and clientHeight agree and the button would remove itself.
  const measure = useCallback(() => {
    const el = textRef.current;
    if (!el || expanded) return;
    setClamps(el.scrollHeight - el.clientHeight > 1);
  }, [expanded]);

  useEffect(() => {
    measure();
    const el = textRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, description]);

  if (!comment && !description) return null;

  return (
    <div className="album-notes">
      {comment && (
        <p className="album-notes-comment" data-selectable>{comment}</p>
      )}
      {description && (
        <div className="album-notes-description">
          <div
            ref={textRef}
            className={`album-notes-text${expanded ? ' is-expanded' : ''}`}
            style={{ ['--album-notes-lines' as string]: String(CLAMPED_LINES) }}
            data-selectable
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(description) }}
          />
          {(clamps || expanded) && (
            <button
              type="button"
              className="album-notes-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded(v => !v)}
            >
              {expanded ? t('albumDetail.notesShowLess') : t('albumDetail.notesShowMore')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
