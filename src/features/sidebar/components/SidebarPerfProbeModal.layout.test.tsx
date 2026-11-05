import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import SidebarPerfProbeModal from '@/features/sidebar/components/SidebarPerfProbeModal';
import { getPerfProbeFlags } from '@/lib/perf/perfFlags';

// The tabs poll the backend; the layout under test is the modal frame around them.
vi.mock('@/features/sidebar/components/perfProbe/SidebarPerfProbeMonitorTab', () => ({ default: () => <div>monitor</div> }));
vi.mock('@/features/sidebar/components/perfProbe/SidebarPerfProbeConnectionsTab', () => ({ default: () => <div>connections</div> }));
vi.mock('@/features/sidebar/components/perfProbe/SidebarPerfProbeTogglesTab', () => ({ default: () => <div>toggles</div> }));
vi.mock('@/features/sidebar/components/perfProbe/SidebarPerfProbeTuningTab', () => ({ default: () => <div>tuning</div> }));
vi.mock('@/features/sidebar/components/perfProbe/SidebarPerfProbeLogsTab', () => ({ default: () => <div>logs</div> }));

// The real stylesheets: the reset (box-sizing) and the shared modal rules.
const SHEETS = ['src/styles/themes/reset.css', 'src/styles/components/modal.css'];

// jsdom resolves vw/vh against the window's innerWidth/innerHeight whenever a
// style is read. Both are "replaceable" properties: a plain assignment replaces
// them on jsdom's own window object, which is the one the resolver reads.
const view = document.defaultView as Window & { innerWidth: number; innerHeight: number };
const JSDOM_VIEWPORT = { width: view.innerWidth, height: view.innerHeight };

function setViewport(width: number, height: number) {
  view.innerWidth = width;
  view.innerHeight = height;
}

function px(value: string): number {
  const match = /^(-?[\d.]+)px$/.exec(value);
  if (!match) throw new Error(`expected a resolved px length, got "${value}"`);
  return Number(match[1]);
}

/**
 * The largest size the panel can end up with: its preferred size, clipped by its
 * cap. The overlay spans the window, so a percentage width is a share of it; an
 * `auto` height grows with the tab content (the Monitor tab overflows) up to the cap.
 */
function panelSize(panel: HTMLElement) {
  const style = getComputedStyle(panel);
  const cap = (value: string) => (value === 'none' ? Infinity : px(value));
  const percent = /^([\d.]+)%$/.exec(style.width);
  const width = percent ? (Number(percent[1]) / 100) * view.innerWidth : px(style.width);
  const height = style.height === 'auto' ? Infinity : px(style.height);
  return {
    width: Math.min(width, cap(style.maxWidth)),
    height: Math.min(height, cap(style.maxHeight)),
  };
}

function renderPsyLab() {
  render(
    <SidebarPerfProbeModal
      open
      onClose={vi.fn()}
      perfFlags={getPerfProbeFlags()}
      hotCacheEnabled={false}
      setHotCacheEnabled={vi.fn()}
      normalizationEngine="off"
      setNormalizationEngine={vi.fn()}
      loggingMode="off"
      setLoggingMode={vi.fn()}
    />,
  );
  const overlay = document.querySelector('.modal-overlay--perf-probe') as HTMLElement;
  const panel = document.querySelector('.sidebar-perf-modal') as HTMLElement;
  expect(overlay).not.toBeNull();
  expect(panel).not.toBeNull();
  return { overlay, panel };
}

describe('PsyLab modal — size', () => {
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
    cleanup();
    styles.forEach(style => style.remove());
    setViewport(JSDOM_VIEWPORT.width, JSDOM_VIEWPORT.height);
  });

  // Reported on a 4K screen: the window was about 2140 × 2070 CSS px and PsyLab
  // stayed a fixed 680 × 860 px box, a third of the width.
  it('grows with a large window', () => {
    setViewport(2140, 2070);
    const { panel } = renderPsyLab();
    const size = panelSize(panel);
    expect(size.width / view.innerWidth).toBeGreaterThanOrEqual(0.55);
    expect(size.height / view.innerHeight).toBeGreaterThanOrEqual(0.45);
  });

  // The overlay's top offset plus the panel must stay inside the window, otherwise
  // the footer (Reset all / Close) is pushed off a small screen.
  it.each([
    [800, 600],
    [1280, 720],
    [1920, 1080],
    [2140, 2070],
    [3840, 2160],
  ])('fits inside a %i × %i window', (width, height) => {
    setViewport(width, height);
    const { overlay, panel } = renderPsyLab();
    const size = panelSize(panel);
    expect(size.width).toBeLessThanOrEqual(width);
    expect(px(getComputedStyle(overlay).paddingTop) + size.height).toBeLessThanOrEqual(height);
  });

  it('scrolls only the tab body and keeps the header, tabs and footer in view', () => {
    const { panel } = renderPsyLab();
    expect(getComputedStyle(panel).display).toBe('flex');
    expect(getComputedStyle(panel).flexDirection).toBe('column');
    expect(getComputedStyle(panel).overflow).toBe('hidden');

    const body = panel.querySelector('.sidebar-perf-modal__body') as HTMLElement;
    expect(getComputedStyle(body).flexGrow).toBe('1');
    expect(getComputedStyle(body).minHeight).toBe('0px');
    expect(getComputedStyle(body).overflowY).toBe('auto');

    for (const selector of ['.sidebar-perf-modal__header', '.sidebar-perf-modal__tabs', '.sidebar-perf-modal__actions']) {
      const el = panel.querySelector(selector) as HTMLElement;
      expect(el, selector).not.toBeNull();
      expect(getComputedStyle(el).flexShrink, selector).toBe('0');
    }
  });

  // The size belongs to PsyLab alone: every other modal keeps the shared frame.
  it('leaves the shared modal frame untouched', () => {
    renderPsyLab();
    const other = document.createElement('div');
    other.className = 'modal-content';
    document.body.appendChild(other);
    try {
      const style = getComputedStyle(other);
      expect(style.maxWidth).toBe('600px');
      expect(style.width).toBe('90%');
      expect(px(style.maxHeight)).toBeCloseTo(0.8 * view.innerHeight);
    } finally {
      other.remove();
    }
  });
});
