import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { TFunction } from 'i18next';
import type { ColDef } from '@/lib/hooks/useTracklistColumns';
import { TracklistHeader } from '@/ui/tracklist/TracklistHeader';
import { TracklistViewport } from '@/ui/tracklist/TracklistViewport';

const t = ((key: string) => key) as unknown as TFunction;

const COLS: readonly ColDef[] = [
  { key: 'actions', i18nKey: null, nameKey: 'albumDetail.trackActions', minWidth: 64, defaultWidth: 72, required: true, align: 'center' },
  { key: 'title',   i18nKey: 'trackTitle', minWidth: 240, defaultWidth: 340, required: true },
];

// The real stylesheets, in the app's order (tracklist.css before the model-A rules).
const SHEETS = ['src/styles/components/tracklist.css', 'src/styles/components/tracklist-model-a.css'];

describe('TracklistHeader — cell height', () => {
  let styles: HTMLStyleElement[] = [];

  beforeEach(() => {
    styles = SHEETS.map(path => {
      const style = document.createElement('style');
      style.textContent = readFileSync(resolve(process.cwd(), path), 'utf8');
      document.head.appendChild(style);
      return style;
    });
  });

  afterEach(() => {
    styles.forEach(style => style.remove());
  });

  // A cell without a label (a column of row buttons) has no content height of its
  // own; unless every cell fills the row, it collapses to 0 px and takes its
  // divider and the area that holds or right-clicks the column with it.
  it('lets every header cell fill the row instead of its label height', () => {
    const { container } = render(
      <TracklistViewport
        contentWidth={412}
        header={(
          <TracklistHeader
            cols={COLS}
            gridStyle={{ gridTemplateColumns: '72px 340px' }}
            renderLabel={col => (col.key === 'title' ? 'TITLE' : '')}
            onResizeStart={vi.fn()}
            onAutofit={vi.fn()}
            widthOf={() => 100}
            t={t}
          />
        )}
      >
        <div>rows</div>
      </TracklistViewport>,
    );
    const header = container.querySelector('.tl-header') as HTMLElement;
    const empty = container.querySelector('.tl-head-cell[data-tl-col="actions"]') as HTMLElement;
    expect(getComputedStyle(header).alignItems).toBe('stretch');
    // The row's vertical padding lives in the cells, so the whole height belongs to a column.
    expect(getComputedStyle(header).paddingTop).toBe('0px');
    expect(getComputedStyle(header).paddingBottom).toBe('0px');
    expect(getComputedStyle(empty).paddingTop).not.toMatch(/^0(px)?$/);
  });
});
