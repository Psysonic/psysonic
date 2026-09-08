import { describe, expect, it } from 'vitest';
import { smartPlaylists as bgSmart } from './bg/smartPlaylists';
import { help as bgHelp } from './bg/help';
import { smartPlaylists as deSmart } from './de/smartPlaylists';
import { help as deHelp } from './de/help';
import { smartPlaylists as enSmart } from './en/smartPlaylists';
import { help as enHelp } from './en/help';
import { smartPlaylists as esSmart } from './es/smartPlaylists';
import { help as esHelp } from './es/help';
import { smartPlaylists as frSmart } from './fr/smartPlaylists';
import { help as frHelp } from './fr/help';
import { smartPlaylists as huSmart } from './hu/smartPlaylists';
import { help as huHelp } from './hu/help';
import { smartPlaylists as itSmart } from './it/smartPlaylists';
import { help as itHelp } from './it/help';
import { smartPlaylists as jaSmart } from './ja/smartPlaylists';
import { help as jaHelp } from './ja/help';
import { smartPlaylists as nbSmart } from './nb/smartPlaylists';
import { help as nbHelp } from './nb/help';
import { smartPlaylists as nlSmart } from './nl/smartPlaylists';
import { help as nlHelp } from './nl/help';
import { smartPlaylists as plSmart } from './pl/smartPlaylists';
import { help as plHelp } from './pl/help';
import { smartPlaylists as roSmart } from './ro/smartPlaylists';
import { help as roHelp } from './ro/help';
import { smartPlaylists as ruSmart } from './ru/smartPlaylists';
import { help as ruHelp } from './ru/help';
import { smartPlaylists as ukSmart } from './uk/smartPlaylists';
import { help as ukHelp } from './uk/help';
import { smartPlaylists as zhSmart } from './zh/smartPlaylists';
import { help as zhHelp } from './zh/help';

const smartLocales = {
  bg: bgSmart, de: deSmart, en: enSmart, es: esSmart, fr: frSmart,
  hu: huSmart, it: itSmart, ja: jaSmart, nb: nbSmart, nl: nlSmart,
  pl: plSmart, ro: roSmart, ru: ruSmart, uk: ukSmart, zh: zhSmart,
};

const helpLocales = {
  bg: bgHelp, de: deHelp, en: enHelp, es: esHelp, fr: frHelp,
  hu: huHelp, it: itHelp, ja: jaHelp, nb: nbHelp, nl: nlHelp,
  pl: plHelp, ro: roHelp, ru: ruHelp, uk: ukHelp, zh: zhHelp,
};

describe('smart playlist locale parity', () => {
  const englishKeys = Object.keys(enSmart).sort();

  it.each(Object.entries(smartLocales))('%s matches the English smart-playlist key shape', (_locale, translation) => {
    expect(Object.keys(translation).sort()).toEqual(englishKeys);
  });

  it.each(Object.entries(helpLocales))('%s includes the relocated smart-playlist FAQ entries', (_locale, translation) => {
    expect(translation.q55).toBeTruthy();
    expect(translation.a55).toBeTruthy();
    expect(translation.q56).toBeTruthy();
    expect(translation.a56).toBeTruthy();
  });
});
