import { describe, expect, it } from 'vitest';
import { migrateLegacyDiscordTemplates } from './authDiscordTemplateMigration';

const NEW_DEFAULTS = {
  discordTemplateDetails: '{title}',
  discordTemplateState: '{artist}',
  discordTemplateName: '',
};

describe('migrateLegacyDiscordTemplates', () => {
  it('moves the untouched defaults of 1.4x to 1.56 to the new defaults', () => {
    const persisted = {
      discordTemplateDetails: '{artist}',
      discordTemplateState: '{title}',
      discordTemplateName: '{title}',
      discordTemplateLargeText: '{album}',
      crossfadeSecs: 7,
    };
    expect(migrateLegacyDiscordTemplates(persisted)).toEqual({
      ...persisted,
      ...NEW_DEFAULTS,
    });
  });

  it('moves the untouched first-release defaults, which still show the album in the member list', () => {
    const persisted = {
      discordTemplateDetails: '{artist} - {title}',
      discordTemplateState: '{album}',
      discordTemplateName: '{title}',
    };
    expect(migrateLegacyDiscordTemplates(persisted)).toEqual(NEW_DEFAULTS);
  });

  it('moves an untouched set that predates the name template', () => {
    const persisted = {
      discordTemplateDetails: '{artist} - {title}',
      discordTemplateState: '{album}',
    };
    expect(migrateLegacyDiscordTemplates(persisted)).toEqual(NEW_DEFAULTS);
  });

  it('keeps customized lines', () => {
    const persisted = {
      discordTemplateDetails: '{artist}',
      discordTemplateState: '{album}',
      discordTemplateName: '{title}',
    };
    expect(migrateLegacyDiscordTemplates(persisted)).toBe(persisted);
  });

  it('keeps a customized name, including the deliberately empty one', () => {
    for (const name of ['', '{title} — {artist}']) {
      const persisted = {
        discordTemplateDetails: '{artist}',
        discordTemplateState: '{title}',
        discordTemplateName: name,
      };
      expect(migrateLegacyDiscordTemplates(persisted)).toBe(persisted);
    }
  });

  it.each([undefined, null, 'garbage', 42])('passes a non-object payload %j through', value => {
    expect(migrateLegacyDiscordTemplates(value)).toBe(value);
  });
});
