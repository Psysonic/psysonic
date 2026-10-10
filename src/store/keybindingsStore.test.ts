import { describe, expect, it, vi } from 'vitest';
import type { KeyAction } from '@/config/shortcutActions';
import { DEFAULT_BINDINGS, useKeybindingsStore } from '@/store/keybindingsStore';

type Persisted = Partial<Record<KeyAction, string | null>>;
type Store = Pick<typeof import('@/store/keybindingsStore'), 'DEFAULT_BINDINGS' | 'useKeybindingsStore'>;

const KEY = 'psysonic_keybindings';

// The shipped Settings chord is platform-dependent, and the shortcut registry
// reads the platform flag at module load — so the macOS case needs its own module
// graph. Plain jsdom already reports a non-mac platform, so Windows/Linux uses the
// static import above.
async function loadMacStore(): Promise<Store> {
  localStorage.clear();
  vi.resetModules();
  vi.doMock('@/lib/util/platform', () => ({ IS_MACOS: true, IS_LINUX: false, IS_WINDOWS: false }));
  return import('@/store/keybindingsStore');
}

async function loadDesktopStore(): Promise<Store> {
  localStorage.clear();
  return { DEFAULT_BINDINGS, useKeybindingsStore };
}

/** Write a stored blob the way the release that shipped it would have, then hydrate. */
async function rehydrate(
  load: () => Promise<Store>, bindings: Persisted | undefined, version: number,
): Promise<[Store, Persisted]> {
  const store = await load();
  if (bindings) localStorage.setItem(KEY, JSON.stringify({ state: { bindings }, version }));
  await store.useKeybindingsStore.persist.rehydrate();
  return [store, store.useKeybindingsStore.getState().bindings];
}

const CASES = [
  { platform: 'macOS', chord: 'super+Comma', load: loadMacStore },
  { platform: 'Windows / Linux', chord: 'ctrl+Comma', load: loadDesktopStore },
] as const;

for (const { platform, chord, load } of CASES) {
  describe(`keybindings persistence (${platform})`, () => {
    it(`ships ${chord} as the out-of-box Settings chord on a fresh install`, async () => {
      const [store, bindings] = await rehydrate(load, undefined, 1);

      expect(store.DEFAULT_BINDINGS['open-settings']).toBe(chord);
      expect(bindings['open-settings']).toBe(chord);
    });

    it(`does not take ${chord} away from an action on a pre-Settings profile`, async () => {
      const [, bindings] = await rehydrate(load, { 'toggle-queue': chord }, 0);

      expect(bindings['toggle-queue']).toBe(chord);
      expect(bindings['open-settings']).toBeNull();
    });

    it(`gives a pre-Settings profile ${chord} when nothing else holds it`, async () => {
      const [, bindings] = await rehydrate(load, { 'toggle-queue': 'ctrl+alt+KeyJ' }, 0);

      expect(bindings['open-settings']).toBe(chord);
    });

    it('leaves later user edits alone, even when they duplicate the chord', async () => {
      const [, before] = await rehydrate(load, { 'toggle-queue': chord }, 0);
      expect(before['open-settings']).toBeNull();

      // The upgrade step has run: the profile is v1 now, so the user is in charge.
      const [, bindings] = await rehydrate(
        load, { 'toggle-queue': chord, 'open-settings': chord }, 1,
      );

      expect(bindings['toggle-queue']).toBe(chord);
      expect(bindings['open-settings']).toBe(chord);
    });

    it('records the migration so it does not run on every launch', async () => {
      const [store] = await rehydrate(load, { 'toggle-queue': chord }, 0);

      store.useKeybindingsStore.getState().setBinding('next', 'KeyJ');

      expect(JSON.parse(localStorage.getItem(KEY) as string).version).toBe(1);
    });
  });
}
