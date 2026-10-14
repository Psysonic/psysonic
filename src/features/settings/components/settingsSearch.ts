import type { TFunction } from 'i18next';
import { GLOBAL_SHORTCUT_ACTIONS, IN_APP_SHORTCUT_ACTIONS } from '@/config/shortcutActions';
import { SETTINGS_SEARCH_SECTIONS, SETTINGS_SEARCH_TAB_KEYS } from '@/generated/settingsSearchIndex';
import { SETTINGS_INDEX, TAB_LABEL_KEY, type Tab } from '@/features/settings/components/settingsTabs';
import {
  exactTokenScore, prepareText, queryTokens, tokenScore, type PreparedText,
} from '@/features/settings/components/settingsSearchMatch';

export type SettingsSearchHit = {
  tab: Tab;
  title: string;
  /** Second line of the result: the row, option or hint that matched, or a shortcut's section. */
  context?: string;
  /** `data-settings-search` value of the target section; absent for text outside sections. */
  focusTitle?: string;
  /** Text of the row to scroll to inside the target. */
  focusText?: string;
  score: number;
  key: string;
};

export interface SettingsSearchOptions {
  /** English strings, matched too so English terms work in every UI language. */
  tEn?: TFunction;
  /** Sections marked `advanced` are only listed while Advanced Mode is on. */
  advancedEnabled?: boolean;
  /** The Users tab exists only for Navidrome admins. */
  usersAvailable?: boolean;
}

interface Field {
  text: PreparedText;
  weight: number;
  /** Row text in the UI language, shown under the result when this field decides the match. */
  display?: string;
}

interface SearchDoc {
  tab: Tab;
  key: string;
  title: string;
  focusTitle?: string;
  /** Fixed second line (shortcut section); otherwise the best-matching row is shown. */
  context?: string;
  focusText?: string;
  advanced: boolean;
  fields: Field[];
}

const MIN_SCORE = 0.3;
const MAX_RESULTS = 40;
const DESCRIPTION_KEY = /(Desc|Description|Hint|Help|Body|Tooltip|Info)(_other)?$/;
const SHORTCUT_SECTION_KEYS = new Set(['settings.inputKeybindingsTitle', 'settings.globalShortcutsTitle']);

function translate(t: TFunction, key: string): string | null {
  const text = t(key, { defaultValue: '' });
  return typeof text === 'string' && text && text !== key ? text : null;
}

function headingFields(title: string, titleEn: string | null): Field[] {
  const fields: Field[] = [{ text: prepareText(title), weight: 1 }];
  if (titleEn && titleEn !== title) fields.push({ text: prepareText(titleEn), weight: 0.9 });
  return fields;
}

function contentFields(keys: readonly string[], t: TFunction, tEn?: TFunction, skip?: Set<string>): Field[] {
  const fields: Field[] = [];
  for (const key of keys) {
    const text = translate(t, key);
    if (!text || skip?.has(text)) continue;
    const description = DESCRIPTION_KEY.test(key);
    fields.push({ text: prepareText(text), weight: description ? 0.6 : 0.75, display: text });
    const en = tEn ? translate(tEn, key) : null;
    if (en && en !== text) fields.push({ text: prepareText(en), weight: description ? 0.5 : 0.65, display: text });
  }
  return fields;
}

const KEYWORDS_BY_TITLE_KEY = new Map(SETTINGS_INDEX.map(entry => [entry.titleKey, entry]));

function shortcutDocs(t: TFunction): SearchDoc[] {
  const docs: SearchDoc[] = [];
  const groups = [
    { actions: IN_APP_SHORTCUT_ACTIONS, sectionKey: 'settings.inputKeybindingsTitle', prefix: 'in-app', words: 'shortcut hotkey keyboard in-app' },
    { actions: GLOBAL_SHORTCUT_ACTIONS, sectionKey: 'settings.globalShortcutsTitle', prefix: 'global', words: 'shortcut hotkey global media' },
  ];
  for (const { actions, sectionKey, prefix, words } of groups) {
    const section = translate(t, sectionKey) ?? '';
    for (const { id, getLabel } of actions) {
      const title = getLabel(t);
      docs.push({
        tab: 'input', key: `${prefix}:${id}`, title, focusTitle: section, context: section, focusText: title, advanced: false,
        fields: [
          { text: prepareText(title), weight: 1 },
          { text: prepareText(`${section} ${words} ${id.replace(/-/g, ' ')}`), weight: 0.7 },
        ],
      });
    }
  }
  return docs;
}

function buildDocs(t: TFunction, tEn?: TFunction): SearchDoc[] {
  const shortcuts = shortcutDocs(t);
  // Shortcuts are listed one by one; their sections must not list them again.
  const shortcutLabels = new Set(shortcuts.map(doc => doc.title));
  const docs: SearchDoc[] = [];
  const indexedTitleKeys = new Set<string>();

  for (const section of SETTINGS_SEARCH_SECTIONS) {
    const tab = section.tab as Tab;
    const title = section.titleKey ? translate(t, section.titleKey) ?? section.titleKey : section.title ?? '';
    const titleEn = section.titleKey && tEn ? translate(tEn, section.titleKey) : null;
    const skip = section.titleKey && SHORTCUT_SECTION_KEYS.has(section.titleKey) ? shortcutLabels : undefined;
    const fields = [...headingFields(title, titleEn), ...contentFields(section.keys, t, tEn, skip)];
    const manual = section.titleKey ? KEYWORDS_BY_TITLE_KEY.get(section.titleKey) : undefined;
    if (manual?.keywords) fields.push({ text: prepareText(manual.keywords), weight: 0.8 });
    if (section.titleKey) indexedTitleKeys.add(section.titleKey);
    docs.push({
      tab, key: section.titleKey ?? `${tab}:${title}`, title, focusTitle: title, advanced: !!section.advanced, fields,
    });
  }

  // Hand-written entries the source walk does not turn into a section (e.g. the Servers heading).
  for (const entry of SETTINGS_INDEX) {
    if (indexedTitleKeys.has(entry.titleKey)) continue;
    const title = translate(t, entry.titleKey) ?? entry.titleKey;
    const titleEn = tEn ? translate(tEn, entry.titleKey) : null;
    const fields = headingFields(title, titleEn);
    if (entry.keywords) fields.push({ text: prepareText(entry.keywords), weight: 0.8 });
    const focusTitle = entry.focusTitleKey ? translate(t, entry.focusTitleKey) ?? undefined : undefined;
    docs.push({ tab: entry.tab, key: entry.titleKey, title, focusTitle, advanced: false, fields });
  }

  for (const [tabId, keys] of Object.entries(SETTINGS_SEARCH_TAB_KEYS)) {
    const tab = tabId as Tab;
    const labelKey = TAB_LABEL_KEY[tab];
    const title = translate(t, labelKey) ?? labelKey;
    const titleEn = tEn ? translate(tEn, labelKey) : null;
    docs.push({
      tab, key: `tab:${tab}`, title, advanced: false,
      fields: [...headingFields(title, titleEn), ...contentFields(keys, t, tEn)],
    });
  }

  return [...docs, ...shortcuts];
}

let cache: { t: TFunction; tEn?: TFunction; docs: SearchDoc[] } | null = null;

function docsFor(t: TFunction, tEn?: TFunction): SearchDoc[] {
  if (!cache || cache.t !== t || cache.tEn !== tEn) cache = { t, tEn, docs: buildDocs(t, tEn) };
  return cache.docs;
}

function scoreDoc(
  doc: SearchDoc,
  tokens: string[],
  allowFuzzy: boolean[],
  phrase: string,
): { score: number; context?: string } | null {
  let total = 0;
  const contextWeight = new Map<string, number>();
  tokens.forEach((token, i) => {
    if (total < 0) return;
    let best = 0;
    let bestField: Field | null = null;
    for (const field of doc.fields) {
      const score = tokenScore(token, field.text, allowFuzzy[i]) * field.weight;
      if (score > best) {
        best = score;
        bestField = field;
      }
    }
    if (best === 0) {
      total = -1;
      return;
    }
    total += best;
    if (bestField?.display) contextWeight.set(bestField.display, (contextWeight.get(bestField.display) ?? 0) + best);
  });
  if (total < 0) return null;

  let score = total / tokens.length;
  if (tokens.length > 1 && doc.fields.some(field => field.text.norm.includes(phrase))) score += 0.2;
  let context: string | undefined;
  let contextBest = 0;
  for (const [text, weight] of contextWeight) {
    if (weight > contextBest) {
      contextBest = weight;
      context = text;
    }
  }
  return { score, context };
}

export function searchSettings(
  query: string,
  activeTab: Tab,
  t: TFunction,
  options: SettingsSearchOptions = {},
): SettingsSearchHit[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  const phrase = tokens.join(' ');
  const { advancedEnabled = true, usersAvailable = true } = options;

  const docs = docsFor(t, options.tEn).filter(doc =>
    !(doc.advanced && !advancedEnabled) && !(doc.tab === 'users' && !usersAvailable));
  // Typos only count for a word that appears nowhere as written.
  const allowFuzzy = tokens.map(token =>
    !docs.some(doc => doc.fields.some(field => exactTokenScore(token, field.text) > 0)));

  const hits: SettingsSearchHit[] = [];
  for (const doc of docs) {
    const match = scoreDoc(doc, tokens, allowFuzzy, phrase);
    if (!match || match.score < MIN_SCORE) continue;
    hits.push({
      tab: doc.tab,
      title: doc.title,
      context: doc.context ?? match.context,
      focusTitle: doc.focusTitle,
      focusText: doc.focusText ?? match.context,
      score: match.score,
      key: doc.key,
    });
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aCurrent = a.tab === activeTab ? 1 : 0;
    const bCurrent = b.tab === activeTab ? 1 : 0;
    if (aCurrent !== bCurrent) return bCurrent - aCurrent;
    return a.title.localeCompare(b.title);
  });

  return hits.slice(0, MAX_RESULTS);
}
