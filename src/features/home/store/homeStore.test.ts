import { describe, expect, it } from 'vitest';
import { DEFAULT_HOME_SECTIONS, useHomeStore } from './homeStore';

async function rehydrateWith(sections: { id: string; visible: boolean }[]) {
  localStorage.setItem('psysonic_home', JSON.stringify({ state: { sections }, version: 0 }));
  await useHomeStore.persist.rehydrate();
  return useHomeStore.getState().sections;
}

describe('home section rehydrate', () => {
  it('slots a newly added section in after its default predecessor', async () => {
    const stored = DEFAULT_HOME_SECTIONS
      .filter(section => section.id !== 'continueListening')
      .map(section => (section.id === 'starred' ? { ...section, visible: false } : section));

    const sections = await rehydrateWith(stored);

    expect(sections.map(section => section.id).slice(0, 4)).toEqual(['hero', 'recent', 'becauseYouLike', 'continueListening']);
    expect(sections).toHaveLength(DEFAULT_HOME_SECTIONS.length);
    // The user's own choices stay untouched.
    expect(sections.find(section => section.id === 'starred')?.visible).toBe(false);
  });

  it('keeps a custom order and appends a section whose predecessor is unknown', async () => {
    const sections = await rehydrateWith([{ id: 'losslessAlbums', visible: true }]);

    expect(sections[0]?.id).toBe('hero');
    expect(sections.map(section => section.id)).toContain('continueListening');
    expect(new Set(sections.map(section => section.id)).size).toBe(DEFAULT_HOME_SECTIONS.length);
  });
});
