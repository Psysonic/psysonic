import { describe, expect, it } from 'vitest';
import { resolveNavidromeShareAvailability } from '@/features/share/shareAvailability';

function resolve(overrides: Partial<Parameters<typeof resolveNavidromeShareAvailability>[0]> = {}) {
  return resolveNavidromeShareAvailability({
    identity: { type: 'navidrome', serverVersion: '0.64.0' },
    status: 'available',
    kind: 'track',
    resourceIds: ['track-1'],
    serverIds: ['srv-a'],
    ...overrides,
  });
}

describe('resolveNavidromeShareAvailability', () => {
  it('requires a positively identified Navidrome 0.64.0 or newer', () => {
    expect(resolve({ identity: undefined })).toEqual({ available: false, reason: 'identity_unknown' });
    expect(resolve({ identity: { type: 'subsonic', serverVersion: '1.16.1' } }))
      .toEqual({ available: false, reason: 'not_navidrome' });
    expect(resolve({ identity: { type: 'navidrome' } }))
      .toEqual({ available: false, reason: 'identity_unknown' });
    expect(resolve({ identity: { type: 'navidrome', serverVersion: '0.63.9' } }))
      .toEqual({ available: false, reason: 'version_too_old' });
    expect(resolve()).toEqual({ available: true });
    expect(resolve({ identity: { type: 'navidrome', serverVersion: '0.65.1' } }))
      .toEqual({ available: true });
  });

  it('maps probe state to stable disabled reasons', () => {
    expect(resolve({ status: 'unknown' })).toEqual({ available: false, reason: 'server_unavailable' });
    expect(resolve({ status: 'server_unavailable' })).toEqual({ available: false, reason: 'server_unavailable' });
    expect(resolve({ status: 'sharing_disabled' })).toEqual({ available: false, reason: 'sharing_disabled' });
  });

  it('rejects unsupported or invalid resource ownership before capability checks', () => {
    expect(resolve({ kind: 'composer' })).toEqual({ available: false, reason: 'composer_unsupported' });
    expect(resolve({ resourceIds: [] })).toEqual({ available: false, reason: 'no_resources' });
    expect(resolve({ serverIds: [] })).toEqual({ available: false, reason: 'server_owner_unknown' });
    expect(resolve({ serverIds: ['srv-a', 'srv-b'] })).toEqual({ available: false, reason: 'multiple_servers' });
  });
});
