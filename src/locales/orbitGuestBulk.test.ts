import { describe, expect, it } from 'vitest';

// The question an Orbit guest gets before many tracks go to the host as
// suggestions (orbitBulkGuard): every locale has it, with the track count.
const modules = import.meta.glob<Record<string, Record<string, string>>>('./*/orbit.ts', { eager: true });
const locales = Object.entries(modules).map(([path, mod]) => [path.split('/')[1], mod.orbit] as const);

describe('Orbit guest bulk question', () => {
  it('covers all locales', () => {
    expect(locales.length).toBeGreaterThanOrEqual(16);
  });

  it.each(locales)('%s has the title, the text with the count and the button', (_lng, orbit) => {
    for (const key of ['bulkConfirmGuestTitle', 'bulkConfirmGuestBody', 'bulkConfirmGuestYes']) {
      expect(orbit[key], key).toBeTruthy();
    }
    expect(orbit.bulkConfirmGuestBody).toContain('{{count}}');
  });
});
