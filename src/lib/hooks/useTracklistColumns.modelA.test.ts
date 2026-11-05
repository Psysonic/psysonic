import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, renderHook } from '@testing-library/react';
import {
  AUTOFIT_MAX_PX,
  TRACK_TITLE_COL,
  fittedWidth,
  gridFor,
  resizedWidth,
  useTracklistColumns,
  type ColDef,
} from '@/lib/hooks/useTracklistColumns';

const KEY = 'psysonic_test_model_a_columns';

const COLUMNS: readonly ColDef[] = [
  { key: 'num',      i18nKey: null,            minWidth: 60, defaultWidth: 60,  required: true, align: 'end' },
  { key: 'title',    i18nKey: 'trackTitle',    ...TRACK_TITLE_COL, required: true },
  { key: 'artist',   i18nKey: 'trackArtist',   minWidth: 80, defaultWidth: 180, required: false },
  { key: 'duration', i18nKey: 'trackDuration', minWidth: 72, defaultWidth: 92,  required: false, align: 'end' },
];

const saved = () => JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
  v?: number; widths: Record<string, number>;
} | null;

describe('column width helpers', () => {
  it('moves a column by the drag distance', () => {
    expect(resizedWidth(200, 37, 80)).toBe(237);
  });

  it('never drags a column below its minimum', () => {
    expect(resizedWidth(200, -500, 80)).toBe(80);
  });

  it('caps an autofit at the maximum', () => {
    expect(AUTOFIT_MAX_PX).toBe(560);
    expect(fittedWidth(900, 80)).toBe(560);
  });

  it('never autofits below the minimum and rounds up', () => {
    expect(fittedWidth(10, 80)).toBe(80);
    expect(fittedWidth(123.2, 80)).toBe(124);
  });
});

describe('useTracklistColumns — every column has a real width', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('gives every column a px width and no fill column', () => {
    const { result } = renderHook(() => useTracklistColumns(COLUMNS, KEY));
    expect(result.current.gridStyle.gridTemplateColumns).toBe('60px 340px 180px 92px');
    expect(result.current.contentWidth).toBe(60 + 340 + 180 + 92);
  });

  it('changes only the column it is told to change', () => {
    const { result } = renderHook(() => useTracklistColumns(COLUMNS, KEY));
    act(() => result.current.setColumnWidth('artist', 250));
    expect(result.current.gridStyle.gridTemplateColumns).toBe('60px 340px 250px 92px');
    expect(saved()?.v).toBe(2);
    expect(saved()?.widths.artist).toBe(250);
  });

  // Before model A the stored title value was a minimum under a 1fr column,
  // not the width the user saw, so it must not become the title's width.
  it('drops the old title value from prefs saved before model A', () => {
    localStorage.setItem(KEY, JSON.stringify({
      widths: { num: 60, title: 260, artist: 222, duration: 92 },
      visible: ['num', 'title', 'artist', 'duration'],
    }));
    const { result } = renderHook(() => useTracklistColumns(COLUMNS, KEY));
    expect(result.current.gridStyle.gridTemplateColumns).toBe('60px 340px 222px 92px');
  });

  it('keeps a title width saved by model A', () => {
    localStorage.setItem(KEY, JSON.stringify({
      v: 2,
      widths: { num: 60, title: 410, artist: 180, duration: 92 },
      visible: ['num', 'title', 'artist', 'duration'],
    }));
    const { result } = renderHook(() => useTracklistColumns(COLUMNS, KEY));
    expect(result.current.gridStyle.gridTemplateColumns).toBe('60px 410px 180px 92px');
  });

  it('keeps a hidden column width for when it comes back', () => {
    const { result } = renderHook(() => useTracklistColumns(COLUMNS, KEY));
    act(() => result.current.setColumnWidth('artist', 210));
    act(() => result.current.toggleColumn('artist'));
    expect(result.current.gridStyle.gridTemplateColumns).toBe('60px 340px 92px');
    act(() => result.current.toggleColumn('artist'));
    expect(result.current.gridStyle.gridTemplateColumns).toBe('60px 340px 210px 92px');
  });
});

describe('useTracklistColumns — column order', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const keys = (result: { current: ReturnType<typeof useTracklistColumns> }) =>
    result.current.visibleCols.map(c => c.key);

  it('moves a column in front of another one', () => {
    const { result } = renderHook(() => useTracklistColumns(COLUMNS, KEY));
    act(() => result.current.moveColumn('duration', 'title', 'before'));
    expect(keys(result)).toEqual(['num', 'duration', 'title', 'artist']);
    expect(result.current.gridStyle.gridTemplateColumns).toBe('60px 92px 340px 180px');
  });

  it('moves a column behind another one', () => {
    const { result } = renderHook(() => useTracklistColumns(COLUMNS, KEY));
    act(() => result.current.moveColumn('title', 'duration', 'after'));
    expect(keys(result)).toEqual(['num', 'artist', 'duration', 'title']);
  });

  it('remembers the order', () => {
    const first = renderHook(() => useTracklistColumns(COLUMNS, KEY));
    act(() => first.result.current.moveColumn('duration', 'title', 'before'));
    first.unmount();
    const { result } = renderHook(() => useTracklistColumns(COLUMNS, KEY));
    expect(keys(result)).toEqual(['num', 'duration', 'title', 'artist']);
  });

  it('keeps the number column first', () => {
    const { result } = renderHook(() => useTracklistColumns(COLUMNS, KEY));
    act(() => result.current.moveColumn('num', 'duration', 'after'));
    expect(keys(result)).toEqual(['num', 'title', 'artist', 'duration']);
    act(() => result.current.moveColumn('artist', 'num', 'before'));
    expect(keys(result)).toEqual(['num', 'artist', 'title', 'duration']);
  });

  it('puts the order back on reset', () => {
    const { result } = renderHook(() => useTracklistColumns(COLUMNS, KEY));
    act(() => result.current.moveColumn('duration', 'title', 'before'));
    act(() => result.current.resetColumns());
    expect(keys(result)).toEqual(['num', 'title', 'artist', 'duration']);
  });

  // A column added in a later version slots in where the list defines it,
  // instead of landing at the far end of a reordered table.
  it('places a column new since the order was saved next to its neighbour', () => {
    localStorage.setItem(KEY, JSON.stringify({
      v: 2,
      widths: { num: 60, title: 340, duration: 92 },
      visible: ['num', 'title', 'duration'],
      known: ['num', 'title', 'duration'],
      order: ['num', 'duration', 'title'],
    }));
    const { result } = renderHook(() => useTracklistColumns(COLUMNS, KEY));
    expect(keys(result)).toEqual(['num', 'duration', 'title', 'artist']);
  });
});

describe('useTracklistColumns — dragging a divider', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function press(clientX: number) {
    return {
      clientX,
      preventDefault: () => {},
      stopPropagation: () => {},
      pointerId: 1,
      currentTarget: { setPointerCapture: () => {} },
    } as unknown as React.PointerEvent;
  }

  it('follows the pointer while the button is held', () => {
    const { result } = renderHook(() => useTracklistColumns(COLUMNS, KEY));
    act(() => result.current.startResize(press(500), 'artist'));
    act(() => { fireEvent.pointerMove(window, { clientX: 550, buttons: 1 }); });
    expect(result.current.colWidths.artist).toBe(230);
    act(() => { fireEvent.pointerUp(window, { clientX: 550 }); });
    expect(saved()?.widths.artist).toBe(230);
  });

  // Move and release can arrive before React has rendered the move.
  it('saves the width of the last move when the release follows at once', () => {
    const { result } = renderHook(() => useTracklistColumns(COLUMNS, KEY));
    act(() => result.current.startResize(press(500), 'artist'));
    act(() => {
      fireEvent.pointerMove(window, { clientX: 560, buttons: 1 });
      fireEvent.pointerUp(window, { clientX: 560 });
    });
    expect(saved()?.widths.artist).toBe(240);
    expect(result.current.colWidths.artist).toBe(240);
  });

  // A release outside the window can get lost; the next move then has no button down.
  it('stops resizing when the button is no longer held', () => {
    const { result } = renderHook(() => useTracklistColumns(COLUMNS, KEY));
    act(() => result.current.startResize(press(500), 'artist'));
    act(() => { fireEvent.pointerMove(window, { clientX: 520, buttons: 1 }); });
    act(() => { fireEvent.pointerMove(window, { clientX: 600, buttons: 0 }); });
    act(() => { fireEvent.pointerMove(window, { clientX: 700, buttons: 1 }); });
    expect(result.current.colWidths.artist).toBe(200);
    expect(document.body.style.cursor).toBe('');
  });
});

describe('gridFor', () => {
  it('lays out a subset of the columns with their widths', () => {
    const { gridStyle, contentWidth } = gridFor([COLUMNS[0], COLUMNS[3]], { num: 60, duration: 100 });
    expect(gridStyle.gridTemplateColumns).toBe('60px 100px');
    expect(contentWidth).toBe(160);
  });

  // A column with no stored width must not produce `undefinedpx` and collapse the rows.
  it('falls back to the default width when a column has none stored', () => {
    const { gridStyle, contentWidth } = gridFor([COLUMNS[2]], {});
    expect(gridStyle.gridTemplateColumns).toBe('180px');
    expect(contentWidth).toBe(180);
  });
});
