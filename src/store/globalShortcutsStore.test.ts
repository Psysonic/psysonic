import { describe, expect, it } from 'vitest';
import { buildGlobalShortcut, formatGlobalShortcut } from './globalShortcutsStore';

describe('global shortcut meta modifier', () => {
  it('stores and displays Command on macOS', () => {
    const event = new KeyboardEvent('keydown', { code: 'KeyF', metaKey: true });

    expect(buildGlobalShortcut(event, true)).toBe('command+KeyF');
    expect(formatGlobalShortcut('command+KeyF', true)).toBe('Command+F');
    expect(formatGlobalShortcut('super+KeyF', true)).toBe('Command+F');
  });

  it('keeps Super on non-macOS platforms', () => {
    const event = new KeyboardEvent('keydown', { code: 'KeyF', metaKey: true });

    expect(buildGlobalShortcut(event, false)).toBe('super+KeyF');
    expect(formatGlobalShortcut('super+KeyF', false)).toBe('Super+F');
  });
});
