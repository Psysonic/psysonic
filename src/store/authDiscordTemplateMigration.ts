import {
  DEFAULT_DISCORD_TEMPLATE_DETAILS,
  DEFAULT_DISCORD_TEMPLATE_NAME,
  DEFAULT_DISCORD_TEMPLATE_STATE,
} from './authStoreDefaults';

/**
 * Details/state pairs that older builds stored as their defaults, newest first.
 * The first-release pair puts the album on the `state` line, which the Discord
 * member list now shows, so leaving it in place would turn the member list
 * from the song title into the album name.
 */
const LEGACY_DEFAULT_PAIRS = [
  { details: '{artist}', state: '{title}' },
  { details: '{artist} - {title}', state: '{album}' },
] as const;

/** The old name default, or no name at all from builds that predate it. */
const LEGACY_DEFAULT_NAMES = new Set<unknown>(['{title}', undefined]);

/**
 * Persist migration to auth store version 3 (#1828): a template set nobody
 * edited moves to the current defaults. Any edited line keeps the whole set
 * as it is, including a deliberately empty name.
 */
export function migrateLegacyDiscordTemplates(persisted: unknown): unknown {
  if (!persisted || typeof persisted !== 'object') return persisted;
  const state = persisted as Record<string, unknown>;
  const untouched =
    LEGACY_DEFAULT_PAIRS.some(
      pair =>
        state.discordTemplateDetails === pair.details && state.discordTemplateState === pair.state,
    ) && LEGACY_DEFAULT_NAMES.has(state.discordTemplateName);
  if (!untouched) return persisted;
  return {
    ...state,
    discordTemplateDetails: DEFAULT_DISCORD_TEMPLATE_DETAILS,
    discordTemplateState: DEFAULT_DISCORD_TEMPLATE_STATE,
    discordTemplateName: DEFAULT_DISCORD_TEMPLATE_NAME,
  };
}
