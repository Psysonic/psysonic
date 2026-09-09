import { describe, expect, it } from 'vitest';
import { help as bgHelp } from './bg/help';
import { playlists as bgPlaylists } from './bg/playlists';
import { settings as bgSettings } from './bg/settings';
import { smartPlaylists as bgSmart } from './bg/smartPlaylists';
import { help as deHelp } from './de/help';
import { playlists as dePlaylists } from './de/playlists';
import { settings as deSettings } from './de/settings';
import { smartPlaylists as deSmart } from './de/smartPlaylists';
import { help as enHelp } from './en/help';
import { playlists as enPlaylists } from './en/playlists';
import { settings as enSettings } from './en/settings';
import { smartPlaylists as enSmart } from './en/smartPlaylists';
import { help as esHelp } from './es/help';
import { playlists as esPlaylists } from './es/playlists';
import { settings as esSettings } from './es/settings';
import { smartPlaylists as esSmart } from './es/smartPlaylists';
import { help as frHelp } from './fr/help';
import { playlists as frPlaylists } from './fr/playlists';
import { settings as frSettings } from './fr/settings';
import { smartPlaylists as frSmart } from './fr/smartPlaylists';
import { help as huHelp } from './hu/help';
import { playlists as huPlaylists } from './hu/playlists';
import { settings as huSettings } from './hu/settings';
import { smartPlaylists as huSmart } from './hu/smartPlaylists';
import { help as itHelp } from './it/help';
import { playlists as itPlaylists } from './it/playlists';
import { settings as itSettings } from './it/settings';
import { smartPlaylists as itSmart } from './it/smartPlaylists';
import { help as jaHelp } from './ja/help';
import { playlists as jaPlaylists } from './ja/playlists';
import { settings as jaSettings } from './ja/settings';
import { smartPlaylists as jaSmart } from './ja/smartPlaylists';
import { help as nbHelp } from './nb/help';
import { playlists as nbPlaylists } from './nb/playlists';
import { settings as nbSettings } from './nb/settings';
import { smartPlaylists as nbSmart } from './nb/smartPlaylists';
import { help as nlHelp } from './nl/help';
import { playlists as nlPlaylists } from './nl/playlists';
import { settings as nlSettings } from './nl/settings';
import { smartPlaylists as nlSmart } from './nl/smartPlaylists';
import { help as plHelp } from './pl/help';
import { playlists as plPlaylists } from './pl/playlists';
import { settings as plSettings } from './pl/settings';
import { smartPlaylists as plSmart } from './pl/smartPlaylists';
import { help as roHelp } from './ro/help';
import { playlists as roPlaylists } from './ro/playlists';
import { settings as roSettings } from './ro/settings';
import { smartPlaylists as roSmart } from './ro/smartPlaylists';
import { help as ruHelp } from './ru/help';
import { playlists as ruPlaylists } from './ru/playlists';
import { settings as ruSettings } from './ru/settings';
import { smartPlaylists as ruSmart } from './ru/smartPlaylists';
import { help as ukHelp } from './uk/help';
import { playlists as ukPlaylists } from './uk/playlists';
import { settings as ukSettings } from './uk/settings';
import { smartPlaylists as ukSmart } from './uk/smartPlaylists';
import { help as zhHelp } from './zh/help';
import { playlists as zhPlaylists } from './zh/playlists';
import { settings as zhSettings } from './zh/settings';
import { smartPlaylists as zhSmart } from './zh/smartPlaylists';

const smartLocales = {
  bg: bgSmart, de: deSmart, es: esSmart, fr: frSmart,
  hu: huSmart, it: itSmart, ja: jaSmart, nb: nbSmart, nl: nlSmart,
  pl: plSmart, ro: roSmart, ru: ruSmart, uk: ukSmart, zh: zhSmart,
};

const helpLocales = {
  bg: bgHelp, de: deHelp, es: esHelp, fr: frHelp,
  hu: huHelp, it: itHelp, ja: jaHelp, nb: nbHelp, nl: nlHelp,
  pl: plHelp, ro: roHelp, ru: ruHelp, uk: ukHelp, zh: zhHelp,
};

const playlistLocales = {
  bg: bgPlaylists, de: dePlaylists, es: esPlaylists, fr: frPlaylists,
  hu: huPlaylists, it: itPlaylists, ja: jaPlaylists, nb: nbPlaylists,
  nl: nlPlaylists, pl: plPlaylists, ro: roPlaylists, ru: ruPlaylists,
  uk: ukPlaylists, zh: zhPlaylists,
};

const settingsLocales = {
  bg: bgSettings, de: deSettings, es: esSettings, fr: frSettings,
  hu: huSettings, it: itSettings, ja: jaSettings, nb: nbSettings,
  nl: nlSettings, pl: plSettings, ro: roSettings, ru: ruSettings,
  uk: ukSettings, zh: zhSettings,
};

const helpKeys = ['a33', 'q55', 'a55', 'q56', 'a56'] as const;
const playlistKeys = [
  'sortDefaultServerOrder',
  'editRules',
  'smartReadOnlyEmpty',
  'refreshSmart',
  'refreshSmartSuccess',
  'refreshSmartError',
] as const;
const settingsKeys = [
  'smartPlaylistCustomFieldsTitle',
  'smartPlaylistCustomFieldsDesc',
  'smartPlaylistCustomFieldsList',
  'smartPlaylistCustomFieldsEmpty',
  'smartPlaylistCustomFieldsInvalid',
  'smartPlaylistCustomFieldsDuplicate',
  'smartPlaylistCustomFieldsRemove',
] as const;

describe('smart playlist locale parity', () => {
  const englishKeys = Object.keys(enSmart).sort();
  const placeholders = (value: string) => value.match(/{{[^}]+}}/g)?.sort() ?? [];

  it.each(Object.entries(smartLocales))('%s matches the English smart-playlist key shape', (_locale, translation) => {
    expect(Object.keys(translation).sort()).toEqual(englishKeys);

    const localized = translation as Record<string, string>;
    for (const [key, englishValue] of Object.entries(enSmart)) {
      expect(placeholders(localized[key])).toEqual(placeholders(englishValue));
    }
  });

  it.each(Object.entries(helpLocales))('%s localizes the smart-playlist FAQ entries', (_locale, translation) => {
    for (const key of helpKeys) {
      expect(translation[key]).toBeTruthy();
      expect(translation[key]).not.toBe(enHelp[key]);
    }
  });

  it.each(Object.entries(playlistLocales))('%s localizes the smart-playlist playlist actions', (_locale, translation) => {
    for (const key of playlistKeys) {
      expect(translation[key]).toBeTruthy();
      if (key !== 'sortDefaultServerOrder') {
        expect(translation[key]).not.toBe(enPlaylists[key]);
      }
    }
  });

  it.each(Object.entries(settingsLocales))('%s localizes the custom-field settings', (_locale, translation) => {
    for (const key of settingsKeys) {
      expect(translation[key]).toBeTruthy();
      expect(translation[key]).not.toBe(enSettings[key]);
    }
  });
});
