import { StrictMode } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';
import { useLyricsZoomKeyboard } from './useLyricsZoomKeyboard';

function Surface({ fullscreen = false, visible = true, hidden = false, name = 'panel' }) {
  const ref = useLyricsZoomKeyboard(fullscreen);
  return visible ? <div ref={ref} hidden={hidden} data-testid={name}><button>{name}</button></div> : null;
}

function key(target: EventTarget = window, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(event); });
  return event;
}

function layout(node: HTMLElement, rect: DOMRect) {
  node.getBoundingClientRect = vi.fn(() => rect);
  Object.defineProperties(node, {
    clientWidth: { configurable: true, get: () => rect.width },
    clientHeight: { configurable: true, get: () => rect.height },
    offsetWidth: { configurable: true, get: () => rect.width },
    offsetHeight: { configurable: true, get: () => rect.height },
  });
}

beforeEach(() => {
  resetAuthStore();
  // jsdom has no layout. Visible fixture surfaces explicitly have area;
  // collapsed/clipped tests override these bounds and client metrics below.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 423, 322));
});
afterEach(() => vi.restoreAllMocks());

describe('one contextual lyrics keyboard owner', () => {
  it('rejects retained focus and hover inside a fully clipped zero-width sidebar, then restores on reopen', () => {
    // jsdom leaves computed overflowX/Y as "visible" for the shorthand;
    // spell out the actual browser-computed clipping axes in this fixture.
    const { getByTestId, getByRole } = render(<div data-testid="clip" style={{ overflowX: 'hidden', overflowY: 'hidden' }}><Surface /></div>);
    const bounds = new DOMRect(0, 0, 423, 322);
    layout(getByTestId('clip'), bounds);
    const surface = getByTestId('panel');
    fireEvent.pointerEnter(surface);
    getByRole('button').focus();
    expect(key(document.activeElement!).defaultPrevented).toBe(true);
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
    bounds.width = 0; // The mounted child keeps its own 423px layout width.
    expect(surface.getBoundingClientRect().width).toBe(423);
    expect(document.activeElement).toBe(getByRole('button'));
    expect(key(document.activeElement!).defaultPrevented).toBe(false);
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
    bounds.width = 423;
    expect(key(document.activeElement!).defaultPrevented).toBe(true);
    expect(useAuthStore.getState().lyricsScale).toBe(1.2);
  });

  it('rejects zero-height vertical clips and fully scrolled-out owners', () => {
    const { getByTestId, getByRole } = render(<div data-testid="clip" style={{ overflowY: 'hidden' }}><Surface /></div>);
    const clip = new DOMRect(0, 0, 423, 0);
    layout(getByTestId('clip'), clip);
    getByRole('button').focus();
    expect(key(document.activeElement!).defaultPrevented).toBe(false);
    clip.height = 100;
    layout(getByTestId('panel'), new DOMRect(0, 120, 423, 100));
    expect(key(document.activeElement!).defaultPrevented).toBe(false);
    expect(useAuthStore.getState().lyricsScale).toBe(1);
  });

  it.each([
    { overflowX: 'visible', overflowY: 'clip', width: 0, height: 322 },
    { overflowX: 'clip', overflowY: 'visible', width: 423, height: 0 },
  ] as const)('does not intersect an ancestor on its nonclipping axis: %o', dimensions => {
    const { getByTestId, getByRole } = render(<div data-testid="clip" style={{ overflowX: dimensions.overflowX, overflowY: dimensions.overflowY }}><Surface /></div>);
    layout(getByTestId('clip'), new DOMRect(0, 0, dimensions.width, dimensions.height));
    getByRole('button').focus();
    expect(key(document.activeElement!).defaultPrevented).toBe(true);
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
  });

  it('does not treat a border-only clipping box as visible content', () => {
    const { getByTestId, getByRole } = render(<div data-testid="clip" style={{ overflowX: 'hidden' }}><Surface /></div>);
    const clip = getByTestId('clip');
    layout(clip, new DOMRect(0, 0, 2, 322));
    Object.defineProperties(clip, {
      clientLeft: { configurable: true, value: 1 },
      clientWidth: { configurable: true, value: 0 },
    });
    getByRole('button').focus();
    expect(key(document.activeElement!).defaultPrevented).toBe(false);
  });

  it('allows the independent visible fullscreen owner when the focused panel is clipped', () => {
    const { getByTestId, getByRole, rerender } = render(<><div data-testid="clip" style={{ overflowX: 'hidden', overflowY: 'hidden' }}><Surface /></div><Surface fullscreen name="fullscreen" /></>);
    layout(getByTestId('clip'), new DOMRect(0, 0, 0, 322));
    getByRole('button', { name: 'panel' }).focus();
    const writes = vi.fn();
    const unsubscribe = useAuthStore.subscribe(writes);
    try {
      expect(key(document.activeElement!).defaultPrevented).toBe(true);
      expect(writes).toHaveBeenCalledTimes(1);
      rerender(<><div data-testid="clip" style={{ overflowX: 'hidden', overflowY: 'hidden' }}><Surface /></div><Surface fullscreen name="fullscreen" visible={false} /></>);
      expect(key(document.activeElement!).defaultPrevented).toBe(false);
      expect(writes).toHaveBeenCalledTimes(1);
    } finally { unsubscribe(); }
  });

  it('does not read layout for ordinary keys, but rejects owners with no layout area for zoom keys', () => {
    const { getByTestId, getByRole } = render(<Surface />);
    getByRole('button').focus();
    const measure = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
    measure.mockClear();
    key(document.activeElement!, { key: 'a' });
    key(document.activeElement!, { ctrlKey: false });
    expect(measure).not.toHaveBeenCalled();
    layout(getByTestId('panel'), new DOMRect(0, 0, 0, 0));
    expect(key(document.activeElement!).defaultPrevented).toBe(false);
    layout(getByTestId('panel'), new DOMRect(window.innerWidth + 1, 0, 423, 322));
    expect(key(document.activeElement!).defaultPrevented).toBe(false);
    expect(useAuthStore.getState().lyricsScale).toBe(1);
  });

  it('needs panel focus or hover and stops owning keys when the pointer leaves', () => {
    const { getByTestId, getByRole } = render(<Surface />);
    expect(key().defaultPrevented).toBe(false);
    fireEvent.pointerEnter(getByTestId('panel'));
    expect(key().defaultPrevented).toBe(true);
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
    fireEvent.pointerLeave(getByTestId('panel'));
    expect(key().defaultPrevented).toBe(false);
    getByRole('button').focus();
    expect(key(document.activeElement!).defaultPrevented).toBe(true);
    expect(useAuthStore.getState().lyricsScale).toBe(1.2);
  });

  it.each([
    { key: '=' }, { key: '+', shiftKey: true }, { key: 'Add', code: 'NumpadAdd' },
    { key: '+', ctrlKey: false, metaKey: true },
  ])('accepts plus variants %o', init => {
    const { getByRole } = render(<Surface fullscreen />);
    expect(key(getByRole('button'), init).defaultPrevented).toBe(true);
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
  });

  it.each([{ key: '-' }, { key: 'Subtract', code: 'NumpadSubtract' }, { key: '-', ctrlKey: false, metaKey: true }])('accepts minus variants %o', init => {
    render(<Surface fullscreen />);
    expect(key(window, init).defaultPrevented).toBe(true);
    expect(useAuthStore.getState().lyricsScale).toBe(0.9);
  });

  it.each([{ key: '0' }, { key: 'Insert', code: 'Numpad0' }, { key: '0', ctrlKey: false, metaKey: true }])('resets with %o', init => {
    useAuthStore.setState({ lyricsScale: 1.8 });
    render(<Surface fullscreen />);
    expect(key(window, init).defaultPrevented).toBe(true);
    expect(useAuthStore.getState().lyricsScale).toBe(1);
  });

  it('cancels browser zoom at bounds/reset without unchanged writes', () => {
    render(<Surface fullscreen />);
    const writes = vi.fn();
    const unsubscribe = useAuthStore.subscribe(writes);
    try {
      expect(key(window, { key: '0' }).defaultPrevented).toBe(true);
      expect(writes).not.toHaveBeenCalled();
      act(() => useAuthStore.setState({ lyricsScale: 2 }));
      writes.mockClear();
      expect(key().defaultPrevented).toBe(true);
      expect(writes).not.toHaveBeenCalled();
      act(() => useAuthStore.setState({ lyricsScale: 0.5 }));
      writes.mockClear();
      expect(key(window, { key: '-' }).defaultPrevented).toBe(true);
      expect(writes).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it.each([
    { ctrlKey: false }, { altKey: true }, { isComposing: true }, { keyCode: 229 },
    { metaKey: true }, { key: '_', shiftKey: true, code: 'Minus' },
    { key: ')', shiftKey: true, code: 'Digit0' }, { key: 'a', code: 'KeyA' },
    { key: '?', code: 'Minus' }, { key: '0', shiftKey: true },
  ])('ignores modifiers/composition/unrelated layout chords %o', init => {
    render(<Surface fullscreen />);
    expect(key(window, init).defaultPrevented).toBe(false);
    expect(useAuthStore.getState().lyricsScale).toBe(1);
  });

  it('ignores AltGraph and already-handled events', () => {
    render(<Surface fullscreen />);
    const event = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, cancelable: true });
    Object.defineProperty(event, 'getModifierState', { value: (modifier: string) => modifier === 'AltGraph' });
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    const handled = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, cancelable: true });
    handled.preventDefault();
    act(() => { window.dispatchEvent(handled); });
    expect(useAuthStore.getState().lyricsScale).toBe(1);
  });

  it.each(['input', 'textarea', 'select', 'editable', 'editable-child'])('does not steal typing in %s', tag => {
    const { container } = render(<><Surface fullscreen /><input /><textarea /><select /><div contentEditable><span>editable</span></div></>);
    const target = container.querySelector(tag === 'editable' ? '[contenteditable]' : tag === 'editable-child' ? '[contenteditable] span' : tag)!;
    expect(key(target).defaultPrevented).toBe(false);
    expect(useAuthStore.getState().lyricsScale).toBe(1);
  });

  it('fullscreen wins over a hovered/focused panel, including player chrome, with exactly one write', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const { getByRole, getByTestId } = render(<><Surface /><div className="fs-player" role="dialog" aria-modal="true"><Surface name="fullscreen" fullscreen /><button>Transport</button></div></>);
    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
    fireEvent.pointerEnter(getByTestId('panel'));
    getByRole('button', { name: 'panel' }).focus();
    const writes = vi.fn();
    const unsubscribe = useAuthStore.subscribe(writes);
    try {
      expect(key(document.activeElement!).defaultPrevented).toBe(true);
      expect(writes).toHaveBeenCalledTimes(1);
      expect(useAuthStore.getState().lyricsScale).toBe(1.1);
      getByRole('button', { name: 'Transport' }).focus();
      key(document.activeElement!);
      expect(writes).toHaveBeenCalledTimes(2);
    } finally { unsubscribe(); add.mockRestore(); }
  });

  it('defers to unrelated dialogs/lightboxes, even before focus moves', () => {
    const { container, rerender } = render(<><Surface fullscreen /><div role="dialog" aria-modal="true"><button>Lightbox</button></div></>);
    expect(key().defaultPrevented).toBe(false);
    expect(key(container.querySelector('[role="dialog"] button')!).defaultPrevented).toBe(false);
    rerender(<><Surface fullscreen /><div role="dialog" hidden /></>);
    expect(key().defaultPrevented).toBe(true);
  });

  it('handles conditional mount, hidden ancestors, renderer switches and final listener cleanup in StrictMode', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { getByRole, rerender, unmount } = render(<StrictMode><Surface visible={false} /></StrictMode>);
    expect(key().defaultPrevented).toBe(false);
    rerender(<StrictMode><Surface fullscreen /></StrictMode>);
    const old = getByRole('button');
    expect(key().defaultPrevented).toBe(true);
    rerender(<StrictMode><Surface fullscreen hidden /></StrictMode>);
    expect(key().defaultPrevented).toBe(false);
    rerender(<StrictMode><Surface key="rail" fullscreen /></StrictMode>);
    key();
    expect(useAuthStore.getState().lyricsScale).toBe(1.2);
    unmount();
    expect(key(old).defaultPrevented).toBe(false);
    expect(key().defaultPrevented).toBe(false);
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
    remove.mockRestore();
  });
});
