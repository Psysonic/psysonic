import { describe, expect, it } from 'vitest';
import { createCustomSmartRuleField, resolveSmartPlaylistCapabilities } from './smartPlaylistFields';
import {
  emitSmartRulesDocument,
  parseSmartRulesDocument,
  removeSmartRuleValue,
  setSmartRuleValue,
  smartRulesDocumentToRaw,
  unsupportedSmartRulePaths,
  validateSmartRulesDocument,
} from './smartPlaylistRules';

const futureFixture = {
  all: [
    { contains: { title: 'live' } },
    {
      any: [
        { is: { ndmood_energy: 'Focused' } },
        { futureOperator: { futureField: { nested: true } } },
      ],
    },
  ],
  sort: '-lastplayed,title',
  order: 'asc',
  offset: 5,
  refreshDelay: '1d',
  clientMetadata: { untouched: ['yes'] },
};

// Rule shape as Navidrome 0.64 returns it: album aggregates plus a per-playlist refresh delay.
const navidrome064Fixture = {
  all: [
    { gt: { albumduration: 3600 } },
    { inTheLast: { albumdateadded: 30 } },
    { inTheRange: { albumsongcount: [8, 20] } },
    { lt: { albumsize: 900000000 } },
    { after: { albumdatemodified: '2026-01-01' } },
  ],
  sort: '-albumdateadded,title',
  limit: 50,
  refreshDelay: '12h',
};

const feishinFixture = {
  all: [
    { is: { genre: 'Rock' } },
    { gt: { year: 2000 } },
    { inPlaylist: { id: 'pl-other' } },
  ],
  sort: '-playcount,title',
  limit: 100,
};

describe('smart-rule document adapters', () => {
  it('round-trips a Feishin-style multi-sort membership document losslessly', () => {
    const document = parseSmartRulesDocument(feishinFixture);
    expect(smartRulesDocumentToRaw(document)).toBe(feishinFixture);
    expect(emitSmartRulesDocument(document)).toEqual(feishinFixture);
  });

  it('round-trips nested, custom, legacy, unknown, and unreleased data losslessly', () => {
    const document = parseSmartRulesDocument(futureFixture);

    expect(smartRulesDocumentToRaw(document)).toBe(futureFixture);
    expect(document.root).toMatchObject({
      kind: 'group',
      combinator: 'all',
    });
    expect(document.root?.children[1]).toMatchObject({
      kind: 'group',
      combinator: 'any',
    });
    expect(document.opaquePaths).toEqual([]);
    expect(emitSmartRulesDocument(document)).toEqual({
      all: futureFixture.all,
      sort: futureFixture.sort,
      order: futureFixture.order,
      offset: futureFixture.offset,
      clientMetadata: futureFixture.clientMetadata,
    });
    expect(document.raw.refreshDelay).toBe('1d');
  });

  it('retains malformed/future nodes as opaque AST paths', () => {
    const document = parseSmartRulesDocument({
      any: [
        { is: { genre: 'Rock', mood: 'Fast' } },
        'future-node',
      ],
    });

    expect(document.root?.children.map(node => node.kind)).toEqual(['opaque', 'opaque']);
    expect(document.opaquePaths).toEqual(['/any/0', '/any/1']);
  });

  it('holds 0.64 fields and refreshDelay back from older servers', () => {
    const document = parseSmartRulesDocument({
      all: [
        { gt: { albumduration: 3600 } },
        { contains: { futureField: 'kept' } },
      ],
      refreshDelay: '12h',
      metadata: { gt: { albumduration: 'opaque metadata remains' } },
    });

    expect(document.raw).toEqual({
      all: [
        { gt: { albumduration: 3600 } },
        { contains: { futureField: 'kept' } },
      ],
      refreshDelay: '12h',
      metadata: { gt: { albumduration: 'opaque metadata remains' } },
    });
    const held = {
      all: [{ contains: { futureField: 'kept' } }],
      metadata: { gt: { albumduration: 'opaque metadata remains' } },
    };
    expect(emitSmartRulesDocument(document)).toEqual(held);
    expect(emitSmartRulesDocument(document, resolveSmartPlaylistCapabilities('0.63.2'))).toEqual(held);
    expect(unsupportedSmartRulePaths(document)).toEqual(
      expect.arrayContaining(['/all/0/gt/albumduration', '/refreshDelay']),
    );
  });

  it('round-trips 0.64 album fields and refreshDelay to a 0.64 server unchanged', () => {
    const capabilities = resolveSmartPlaylistCapabilities('0.64.0');
    const document = parseSmartRulesDocument(navidrome064Fixture);

    expect(emitSmartRulesDocument(document, capabilities)).toEqual(navidrome064Fixture);
    expect(validateSmartRulesDocument(document, { capabilities })).toEqual([]);
  });

  it('applies immutable targeted patches without rebuilding siblings or extras', () => {
    const original = parseSmartRulesDocument(futureFixture);
    const changed = setSmartRuleValue(original, '/all/0/contains/title', 'studio');
    const removed = removeSmartRuleValue(changed, '/all/1/any/0');

    expect(original.raw).toBe(futureFixture);
    expect(changed.raw).toMatchObject({
      all: [
        { contains: { title: 'studio' } },
        futureFixture.all[1],
      ],
      refreshDelay: '1d',
      clientMetadata: futureFixture.clientMetadata,
    });
    expect((removed.raw.all as unknown[])[1]).toEqual({
      any: [{ futureOperator: { futureField: { nested: true } } }],
    });
    expect(removed.raw.clientMetadata).toEqual(futureFixture.clientMetadata);
  });
});

describe('smart-rule semantic validation', () => {
  const capabilities = resolveSmartPlaylistCapabilities('0.63.2');

  it('requires exactly one non-empty root', () => {
    expect(validateSmartRulesDocument(parseSmartRulesDocument({}), { capabilities }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'root_required' })]));
    expect(validateSmartRulesDocument(parseSmartRulesDocument({ all: [], any: [] }), { capabilities }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'root_conflict' })]));
    expect(validateSmartRulesDocument(parseSmartRulesDocument({ all: [] }), { capabilities }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'empty_group' })]));
  });

  it('enforces one operator/field and valid values and ranges', () => {
    const document = parseSmartRulesDocument({
      all: [
        { gt: { year: Number.NaN } },
        { inTheRange: { year: [2020, 1990] } },
        { is: { loved: 'true' } },
        { contains: { title: '', album: 'x' } },
      ],
    });
    const issues = validateSmartRulesDocument(document, { capabilities });

    expect(issues.filter(item => item.code === 'invalid_value')).toHaveLength(3);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'invalid_value',
        message: 'Invalid number value for in the range.',
      }),
    ]));
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_rule', path: '/all/3/contains' }),
    ]));
  });

  it('rejects rating values outside 0-5', () => {
    const document = parseSmartRulesDocument({
      all: [
        { is: { rating: 6 } },
        { inTheRange: { albumrating: [0, 9] } },
        { is: { rating: 5 } },
      ],
    });
    const issues = validateSmartRulesDocument(document, { capabilities });
    expect(issues.filter(item => item.code === 'invalid_value')).toHaveLength(2);
    expect(issues.filter(item => item.path === '/all/2/is/rating')).toEqual([]);
  });

  it('requires ID-based non-self playlist references', () => {
    const document = parseSmartRulesDocument({
      all: [
        { inPlaylist: { path: 'other.nsp' } },
        { notInPlaylist: { id: 'self-id' } },
      ],
    });
    const issues = validateSmartRulesDocument(document, {
      capabilities,
      currentPlaylistId: 'self-id',
    });

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_value', path: '/all/0/inPlaylist' }),
      expect.objectContaining({ code: 'self_reference', path: '/all/1/notInPlaylist/id' }),
    ]));
  });

  it('rejects direct and transitive playlist reference cycles', () => {
    const direct = validateSmartRulesDocument(
      parseSmartRulesDocument({ all: [{ inPlaylist: { id: 'self-id' } }] }),
      { capabilities, currentPlaylistId: 'self-id' },
    );
    const transitive = validateSmartRulesDocument(
      parseSmartRulesDocument({ all: [{ inPlaylist: { id: 'playlist-b' } }] }),
      {
        capabilities,
        currentPlaylistId: 'playlist-a',
        playlistRulesById: new Map([
          ['playlist-b', { any: [{ notInPlaylist: { id: 'playlist-c' } }] }],
          ['playlist-c', { all: [{ inPlaylist: { id: 'playlist-a' } }] }],
        ]),
      },
    );

    expect(direct).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'self_reference', path: '/all/0/inPlaylist/id' }),
    ]));
    expect(transitive).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'playlist_cycle', path: '/all/0/inPlaylist/id' }),
    ]));
  });

  it('fails closed when referenced smart-playlist rules are unavailable', () => {
    const issues = validateSmartRulesDocument(
      parseSmartRulesDocument({ all: [{ inPlaylist: { id: 'playlist-b' } }] }),
      {
        capabilities,
        currentPlaylistId: 'playlist-a',
        playlistRulesById: new Map([['playlist-b', undefined]]),
        unresolvedPlaylistRuleIds: new Set(['playlist-b']),
      },
    );

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'playlist_reference_unknown',
        path: '/all/0/inPlaylist/id',
      }),
    ]));
  });

  it('fails closed when an unresolved playlist is reached transitively', () => {
    const issues = validateSmartRulesDocument(
      parseSmartRulesDocument({ all: [{ inPlaylist: { id: 'playlist-b' } }] }),
      {
        capabilities,
        currentPlaylistId: 'playlist-a',
        playlistRulesById: new Map([
          ['playlist-b', { all: [{ inPlaylist: { id: 'playlist-c' } }] }],
          ['playlist-c', undefined],
        ]),
        unresolvedPlaylistRuleIds: new Set(['playlist-c']),
      },
    );

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'playlist_reference_unknown' }),
    ]));
  });

  it('ignores playlist-shaped values outside rule expressions during cycle checks', () => {
    const issues = validateSmartRulesDocument(
      parseSmartRulesDocument({ all: [{ inPlaylist: { id: 'playlist-b' } }] }),
      {
        capabilities,
        currentPlaylistId: 'playlist-a',
        playlistRulesById: new Map([
          ['playlist-b', {
            all: [{ contains: { title: 'live' } }],
            clientMetadata: { inPlaylist: { id: 'playlist-a' } },
          }],
        ]),
      },
    );

    expect(issues.filter(issue => issue.code === 'playlist_cycle')).toEqual([]);
  });

  it('validates fixed/percentage limit and offset constraints', () => {
    const document = parseSmartRulesDocument({
      all: [{ is: { loved: true } }],
      limit: 20,
      limitPercent: 101,
      offset: -1,
    });
    const issues = validateSmartRulesDocument(document, { capabilities });

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_option', path: '/limitPercent' }),
      expect.objectContaining({ code: 'invalid_option', path: '/offset' }),
    ]));
  });

  it('checks refreshDelay against Navidrome duration syntax on 0.64', () => {
    const v064 = resolveSmartPlaylistCapabilities('0.64.0');
    const refreshDelayIssues = (refreshDelay: unknown) => validateSmartRulesDocument(
      parseSmartRulesDocument({ all: [{ is: { loved: true } }], refreshDelay }),
      { capabilities: v064 },
    ).filter(item => item.path === '/refreshDelay');

    for (const valid of ['', '0', '30m', '12h', '1d', '1w2d', '1d12h', '1.5h', '1.5d', '90s', '500ms', '+1h']) {
      expect(refreshDelayIssues(valid), valid).toEqual([]);
    }
    for (const invalid of ['-1h', '1', '1x', '1.d', 'h', 'soon', 12]) {
      expect(refreshDelayIssues(invalid), String(invalid)).toEqual([
        expect.objectContaining({ code: 'invalid_option', severity: 'error' }),
      ]);
    }
  });

  it('reports exact opaque, unknown, unreleased, and version-gated paths', () => {
    const document = parseSmartRulesDocument(futureFixture);
    const paths = unsupportedSmartRulePaths(document, {
      capabilities: resolveSmartPlaylistCapabilities('0.56.0'),
    });

    expect(paths).toEqual(expect.arrayContaining([
      '/all/1/any/0/is/ndmood_energy',
      '/all/1/any/1/futureOperator',
      '/sort',
      '/refreshDelay',
      '/clientMetadata',
    ]));
  });

  it('accepts an unknown server field only after explicit typed registration', () => {
    const document = parseSmartRulesDocument({
      all: [{ is: { ndmood_energy: 'Focused' } }],
    });
    expect(validateSmartRulesDocument(document, { capabilities }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unknown_field' })]));

    const customTag = createCustomSmartRuleField({
      name: 'ndmood_energy',
      type: 'string',
      kind: 'tag',
    });
    expect(validateSmartRulesDocument(document, {
      capabilities,
      customFields: [customTag],
    })).toEqual([]);
  });

  it('limits presence operators to supported nullable/tag fields', () => {
    const document = parseSmartRulesDocument({
      all: [
        { isMissing: { title: true } },
        { isPresent: { genre: true } },
      ],
    });
    const issues = validateSmartRulesDocument(document, { capabilities });

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'unsupported_operator',
        path: '/all/0/isMissing',
      }),
    ]);
  });
});
