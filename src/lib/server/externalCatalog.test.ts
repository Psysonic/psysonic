import { beforeEach, describe, expect, it } from 'vitest';
import { serverHasExternalCatalog, storedServerHasExternalCatalog } from './externalCatalog';

const servers = [
  { id: 'octo', url: 'https://music.example.com:8482' },
  { id: 'local', url: 'https://library.example.com' },
];

describe('external catalog detection', () => {
  beforeEach(() => localStorage.clear());

  it('uses advertised capabilities even when ping says Navidrome', () => {
    const state = {
      servers,
      subsonicServerIdentityByServer: { octo: { type: 'navidrome' } },
      openSubsonicExtensionsByServer: { octo: ['formPost', 'octoAcquisitions'] },
    };
    expect(serverHasExternalCatalog(state, 'octo')).toBe(true);
    expect(serverHasExternalCatalog(state, 'music.example.com:8482')).toBe(true);
    expect(serverHasExternalCatalog(state, 'local')).toBe(false);
    expect(serverHasExternalCatalog(state, 'missing')).toBe(false);
  });

  it('recognizes an explicit Octo identity without extension probes', () => {
    expect(serverHasExternalCatalog({
      servers, subsonicServerIdentityByServer: { octo: { type: 'octo' } },
    }, 'octo')).toBe(true);
  });

  it('can read existing saved capabilities before stores hydrate', () => {
    localStorage.setItem('psysonic-auth', JSON.stringify({ state: {
      servers, openSubsonicExtensionsByServer: { octo: ['octoImports'] },
    } }));
    expect(storedServerHasExternalCatalog('octo')).toBe(true);
    expect(storedServerHasExternalCatalog('library.example.com')).toBe(false);
    localStorage.setItem('psysonic-auth', '{');
    expect(storedServerHasExternalCatalog('octo')).toBe(false);
  });
});
