import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import BurnTrackList from './BurnTrackList';
import { arcColor, arcPalette } from '@/features/burner/utils/arcColor';
import type { DiscArc } from '@/features/burner/utils/capacity';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/dnd/DragDropContext', () => ({
  useDragSource: () => ({ onMouseDown: () => {} }),
}));

vi.mock('@/lib/hooks/useListReorderDnd', () => ({
  useListReorderDnd: () => ({
    isDragging: false,
    setContainer: () => {},
    onMouseMove: () => {},
    dropEdge: () => null,
  }),
}));

function arc(n: number): DiscArc {
  return {
    key: `k${n}`,
    serverId: 'srv',
    trackId: String(n),
    title: `Track ${n}`,
    artist: 'Artist',
    album: 'Album',
    durationSec: 200,
    localPath: '/tmp/a.flac',
    number: n,
    startSector: n * 15_000,
    sectors: 15_000,
  } as DiscArc;
}

function renderList(count: number, over: Partial<Parameters<typeof BurnTrackList>[0]> = {}) {
  const arcs = Array.from({ length: count }, (_, i) => arc(i + 1));
  render(
    <BurnTrackList
      arcs={arcs}
      hoveredIndex={null}
      onHoverChange={() => {}}
      onRemove={() => {}}
      onMove={() => {}}
      onReorder={() => {}}
      activeIndex={null}
      activePhase={null}
      writtenBefore={0}
      stage="building"
      overrunFrom={null}
      viewportRef={createRef<HTMLDivElement>()}
      disabled={false}
      {...over}
    />,
  );
  return screen.getAllByRole('listitem');
}

describe('BurnTrackList row colour', () => {
  it('hands each row a colour the stylesheet can actually resolve', () => {
    // The bug this pins shipped: the row carried `var(--burn-arc-N)`, a token
    // defined nowhere, so `--row-color` was permanently invalid and every rule
    // that read it fell through to the accent. The ring was a six-colour
    // rainbow beside a running order in one flat colour, and nothing caught it
    // because an invalid custom property fails silently.
    const palette = new Set(arcPalette());
    for (const [index, row] of renderList(8).entries()) {
      const colour = row.style.getPropertyValue('--row-color');
      expect(colour).toBe(arcColor(index));
      expect(palette.has(colour)).toBe(true);
      expect(colour).not.toMatch(/--burn-arc/);
    }
  });

  it('agrees with the ring about which colour a track is', () => {
    // The list and the disc must never disagree, and the only thing keeping
    // them together is that both call arcColor.
    const rows = renderList(3);
    expect(rows.map(row => row.style.getPropertyValue('--row-color')))
      .toEqual([arcColor(0), arcColor(1), arcColor(2)]);
  });
});

/**
 * Every column of the grid, in the order the row lays them out.
 *
 * Spelled out rather than counted off a render: the two renders were once
 * compared against each other, and a cell deleted from the markup goes missing
 * from both, so they stayed equal all the way down to an empty row.
 */
const ROW_CELLS = [
  '.burner-row-grip',
  '.burner-row-n',
  '.burner-row-title',
  '.burner-row-artist',
  '.burner-row-dur',
  '.burner-row-msf',
  '.burner-row-fetch',
  '.burner-row-remove',
];

describe('BurnTrackList row shape', () => {
  it('lays out all eight columns whatever the job is doing', () => {
    // The row is an eight-column grid. Dropping the grip and the remove control
    // shifted every later cell one column left, which collapsed every title to
    // a single letter the moment a burn started. Every render is measured
    // against the eight columns the stylesheet declares, not against one
    // another.
    for (const stage of ['building', 'preparing', 'committing', 'settled'] as const) {
      document.body.innerHTML = '';
      const row = renderList(3, { stage })[0];
      expect(row.childElementCount, `cell count while ${stage}`).toBe(ROW_CELLS.length);
      for (const cell of ROW_CELLS) {
        expect(row.querySelector(cell), `${cell} missing while ${stage}`).not.toBeNull();
      }
    }
  });

  it('omits the controls rather than leaving dead tab stops', () => {
    const locked = renderList(3, { stage: 'committing' })[0];
    expect(locked.querySelector('button')).toBeNull();
    expect(locked.querySelector('.burner-row-grip.is-locked')).not.toBeNull();
    expect(locked.querySelector('.burner-row-remove.is-locked')).not.toBeNull();
  });

  it('locks the order from `preparing`, not from the first written sector', () => {
    // `preparing` is already too late to edit: the job took its track list when
    // it started and is fetching and rendering it. Removing or reordering here
    // changed the list on screen and nothing the drive was about to write.
    const preparing = renderList(3, { stage: 'preparing' })[0];
    expect(preparing.querySelector('button')).toBeNull();
    expect(preparing.querySelector('.burner-row-grip.is-locked')).not.toBeNull();
    expect(preparing.querySelector('.burner-row-remove.is-locked')).not.toBeNull();
  });

  it('still hands the user the controls while they are building the disc', () => {
    // The other half of the pin above: locking early must not lock always.
    const building = renderList(3)[0];
    expect(building.querySelector('button.burner-row-remove')).not.toBeNull();
    expect(building.querySelector('.burner-row-grip.is-locked')).toBeNull();
  });
});
