#!/usr/bin/env node
/**
 * Build src/generated/settingsSearchIndex.ts: every Settings section with the
 * translation keys rendered inside it, so the settings search matches the text
 * of rows, groups and hints, not only section titles.
 *
 * Starts at the tab components Settings.tsx renders (`activeTab === '<tab>' && <Tab />`),
 * follows the components and module-level values they use, and records every
 * string literal that is an English translation key. A section is a
 * `<SettingsSubSection>` / `<ThemesSection>` or any element carrying a
 * `data-settings-search` attribute; text outside a section belongs to its tab.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const settingsPage = join(srcDir, 'features/settings/pages/Settings.tsx');

/** Wrapper components that open a section; their own markup is not walked. */
const SECTION_TAGS = new Set(['SettingsSubSection', 'ThemesSection']);
const SECTION_TITLE_ATTRS = new Set(['title', 'searchText', 'data-settings-search']);
/** Only these source trees are followed; stores, API clients and shared UI add toast and dialog text. */
const FOLLOW_ROOTS = ['features', 'config'].map(d => join(srcDir, d) + sep);
const SKIP_PATH_PARTS = [`${sep}store${sep}`, `${sep}api${sep}`, `${sep}hooks${sep}`, `${sep}utils${sep}`];
const MAX_PREFIX_KEYS = 60;
/** Rendered by shared row components on every section; matching it would hit everything. */
const IGNORED_KEYS = new Set(['settings.advancedBadge']);
/** Generic button words (Add, Cancel, Save) would point every such query at the same tab. */
const IGNORED_PREFIXES = ['common.'];

const sourceCache = new Map();
function parse(file) {
  let sf = sourceCache.get(file);
  if (!sf) {
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind);
    sourceCache.set(file, sf);
  }
  return sf;
}

function unwrap(node) {
  while (node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node))) {
    node = node.expression;
  }
  return node;
}

function propName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

// ── English key set ─────────────────────────────────────────────────────────

function collectLocaleKeys() {
  const dir = join(srcDir, 'locales/en');
  const keys = new Set();
  const addObject = (node, prefix) => {
    node = unwrap(node);
    if (!node || !ts.isObjectLiteralExpression(node)) {
      keys.add(prefix);
      return;
    }
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const name = propName(prop.name);
      if (name !== null) addObject(prop.initializer, `${prefix}.${name}`);
    }
  };
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.ts') || name === 'index.ts' || name.endsWith('.test.ts')) continue;
    for (const stmt of parse(join(dir, name)).statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) addObject(decl.initializer, decl.name.text);
      }
    }
  }
  return keys;
}

const localeKeys = collectLocaleKeys();
const sortedLocaleKeys = [...localeKeys].sort();

/** A literal is a key when it names a string, or a plural family (`key_one` / `key_other`). */
function resolveKey(literal) {
  if (localeKeys.has(literal)) return literal;
  if (localeKeys.has(`${literal}_other`)) return `${literal}_other`;
  return null;
}

// ── Module resolution ───────────────────────────────────────────────────────

function resolveModule(fromFile, spec) {
  let base;
  if (spec.startsWith('@/')) base = join(srcDir, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const importCache = new Map();
function importsOf(file) {
  let imports = importCache.get(file);
  if (imports) return imports;
  imports = new Map();
  for (const stmt of parse(file).statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause || stmt.importClause.isTypeOnly) continue;
    const spec = stmt.moduleSpecifier.text;
    const clause = stmt.importClause;
    if (clause.name) imports.set(clause.name.text, { spec, imported: 'default' });
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        if (el.isTypeOnly) continue;
        imports.set(el.name.text, { spec, imported: (el.propertyName ?? el.name).text });
      }
    }
  }
  importCache.set(file, imports);
  return imports;
}

function hasDefaultModifier(node) {
  return (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
}

/** Finds the top-level declaration `name` in `file`, following re-exports. */
function findDeclaration(file, name, depth = 0) {
  if (depth > 8) return null;
  for (const stmt of parse(file).statements) {
    if (ts.isFunctionDeclaration(stmt)) {
      if ((name === 'default' && hasDefaultModifier(stmt)) || stmt.name?.text === name) return { file, node: stmt };
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) return { file, node: decl.initializer };
      }
    } else if (ts.isExportAssignment(stmt) && name === 'default') {
      const expr = unwrap(stmt.expression);
      if (ts.isIdentifier(expr)) return findDeclaration(file, expr.text, depth + 1);
      return { file, node: expr };
    } else if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly) {
      const target = stmt.moduleSpecifier ? resolveModule(file, stmt.moduleSpecifier.text) : file;
      if (!target) continue;
      if (!stmt.exportClause) {
        if (stmt.moduleSpecifier) {
          const found = findDeclaration(target, name, depth + 1);
          if (found) return found;
        }
        continue;
      }
      if (!ts.isNamedExports(stmt.exportClause)) continue;
      for (const el of stmt.exportClause.elements) {
        if (el.name.text !== name) continue;
        const local = (el.propertyName ?? el.name).text;
        if (target === file && local === name) continue;
        return findDeclaration(target, local, depth + 1);
      }
    }
  }
  return null;
}

function isFollowable(file) {
  if (/\.test\.tsx?$/.test(file)) return false;
  if (!FOLLOW_ROOTS.some(rootDir => file.startsWith(rootDir))) return false;
  return !SKIP_PATH_PARTS.some(part => file.includes(part));
}

/** A `const` or function declared in a block around `id` (component bodies, handlers). */
function findScopedDeclaration(id) {
  const name = id.text;
  for (let scope = id.parent; scope && !ts.isSourceFile(scope); scope = scope.parent) {
    if (!ts.isBlock(scope)) continue;
    for (const stmt of scope.statements) {
      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) return decl.initializer;
        }
      } else if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) {
        return stmt;
      }
    }
  }
  return null;
}

/** Resolves an identifier used in `file` to its declaration (enclosing scopes, file, then imports). */
function resolveIdentifier(file, name, id) {
  const scoped = id ? findScopedDeclaration(id) : null;
  if (scoped) return { file, node: scoped };
  const local = findDeclaration(file, name);
  if (local) return local;
  const imp = importsOf(file).get(name);
  if (!imp) return null;
  const target = resolveModule(file, imp.spec);
  if (!target) return null;
  return findDeclaration(target, imp.imported);
}

// ── Walk ────────────────────────────────────────────────────────────────────

const sections = new Map();
const tabKeys = new Map();

function addKey(ctx, key) {
  if (ctx.section) ctx.section.keys.add(key);
  else {
    if (!tabKeys.has(ctx.tab)) tabKeys.set(ctx.tab, new Set());
    tabKeys.get(ctx.tab).add(key);
  }
}

function tagNameOf(opening) {
  return ts.isIdentifier(opening.tagName) ? opening.tagName.text : null;
}

/** `t('key')` or `'literal'` → title; anything else (props, templates) is not a fixed heading. */
function titleOf(expr) {
  expr = unwrap(expr);
  if (!expr) return null;
  if (ts.isStringLiteral(expr)) return { title: expr.text };
  if (ts.isJsxExpression(expr)) return titleOf(expr.expression);
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === 't') {
    const arg = expr.arguments[0];
    if (arg && ts.isStringLiteralLike(arg)) {
      const key = resolveKey(arg.text);
      if (key) return { titleKey: key };
    }
  }
  return null;
}

function openSection(ctx, opening) {
  const tag = tagNameOf(opening);
  const attrs = opening.attributes.properties.filter(ts.isJsxAttribute);
  const attr = n => attrs.find(a => a.name.getText() === n);
  const titleAttr = (tag && SECTION_TAGS.has(tag) ? attr('title') : null) ?? attr('data-settings-search');
  if (!titleAttr?.initializer) return null;
  const title = titleOf(titleAttr.initializer);
  if (!title) return null;
  const advancedAttr = attr('advanced');
  const advanced = !!advancedAttr && (!advancedAttr.initializer || titleOfBoolean(advancedAttr.initializer));
  const id = `${ctx.tab}|${title.titleKey ?? title.title}`;
  let section = sections.get(id);
  if (!section) {
    section = { tab: ctx.tab, ...title, advanced, keys: new Set() };
    sections.set(id, section);
  }
  return section;
}

function titleOfBoolean(init) {
  const expr = ts.isJsxExpression(init) ? unwrap(init.expression) : init;
  return !(expr && expr.kind === ts.SyntaxKind.FalseKeyword);
}

function followDeclaration(ctx, decl) {
  if (!decl || !isFollowable(decl.file)) return;
  const visitKey = `${ctx.tab}|${ctx.section ? `${ctx.section.titleKey ?? ctx.section.title}` : ''}|${decl.file}|${decl.node.pos}`;
  if (ctx.seen.has(visitKey)) return;
  ctx.seen.add(visitKey);
  walk(decl.node, { ...ctx, file: decl.file });
}

function walkJsx(node, opening, ctx) {
  const tag = tagNameOf(opening);
  const section = openSection(ctx, opening);
  const inner = section ? { ...ctx, section } : ctx;
  if (tag && /^[A-Z]/.test(tag) && !SECTION_TAGS.has(tag)) {
    followDeclaration(ctx, resolveIdentifier(ctx.file, tag));
  }
  for (const prop of opening.attributes.properties) {
    if (section && ts.isJsxAttribute(prop) && SECTION_TITLE_ATTRS.has(prop.name.getText())) continue;
    walk(prop, inner);
  }
  if (ts.isJsxElement(node)) for (const child of node.children) walk(child, inner);
}

function walk(node, ctx) {
  if (!node) return;
  if (ts.isImportDeclaration(node) || ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
  if (ts.isJsxElement(node)) return walkJsx(node, node.openingElement, ctx);
  if (ts.isJsxSelfClosingElement(node)) return walkJsx(node, node, ctx);
  if (ts.isStringLiteralLike(node)) {
    const key = resolveKey(node.text);
    if (key && !IGNORED_KEYS.has(key) && !IGNORED_PREFIXES.some(p => key.startsWith(p))) addKey(ctx, key);
    return;
  }
  if (ts.isTemplateExpression(node)) {
    // `t(`settings.theme_${id}`)` — take every key under the fixed prefix, when that stays small.
    const prefix = node.head.text;
    if (prefix.includes('.') && prefix.length >= 6) {
      const matches = sortedLocaleKeys.filter(k => k.startsWith(prefix));
      if (matches.length <= MAX_PREFIX_KEYS) for (const k of matches) addKey(ctx, k);
    }
  }
  if (ts.isIdentifier(node) && isValueReference(node)) {
    const name = node.text;
    if (!/^use[A-Z]/.test(name)) followDeclaration(ctx, resolveIdentifier(ctx.file, name, node));
    return;
  }
  ts.forEachChild(node, child => walk(child, ctx));
}

function isValueReference(id) {
  const parent = id.parent;
  if (!parent) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name === id) return false;
  if ((ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)) && parent.name === id) return false;
  if (ts.isJsxAttribute(parent) || ts.isJsxOpeningElement(parent) || ts.isJsxClosingElement(parent) || ts.isJsxSelfClosingElement(parent)) return false;
  return true;
}

// ── Tab roots from Settings.tsx ─────────────────────────────────────────────

function flattenAnd(node, out = []) {
  node = unwrap(node);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    flattenAnd(node.left, out);
    flattenAnd(node.right, out);
  } else out.push(node);
  return out;
}

function tabOf(operand) {
  if (!ts.isBinaryExpression(operand) || operand.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) return null;
  if (!ts.isIdentifier(operand.left) || operand.left.text !== 'activeTab') return null;
  return ts.isStringLiteral(operand.right) ? operand.right.text : null;
}

const tabRoots = [];
(function findTabRoots(node) {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const operands = flattenAnd(node);
    const tab = operands.map(tabOf).find(Boolean);
    const last = operands[operands.length - 1];
    if (tab && (ts.isJsxElement(last) || ts.isJsxSelfClosingElement(last))) {
      tabRoots.push({ tab, node: last });
      return;
    }
  }
  ts.forEachChild(node, findTabRoots);
})(parse(settingsPage));

if (tabRoots.length === 0) throw new Error('no `activeTab === … && <Tab />` roots found in Settings.tsx');

for (const { tab, node } of tabRoots) {
  walk(node, { tab, section: null, file: settingsPage, seen: new Set() });
}

// ── Output ──────────────────────────────────────────────────────────────────

const sectionList = [...sections.values()]
  .map(s => ({
    tab: s.tab,
    ...(s.titleKey ? { titleKey: s.titleKey } : { title: s.title }),
    ...(s.advanced ? { advanced: true } : {}),
    keys: [...s.keys].filter(k => k !== s.titleKey).sort(),
  }))
  .sort((a, b) => `${a.tab}|${a.titleKey ?? a.title}`.localeCompare(`${b.tab}|${b.titleKey ?? b.title}`));

// A component body is walked once for the tab and again for each section that
// references its values; keep tab-level keys to those no section of the tab shows.
const tabKeyObject = Object.fromEntries(
  [...tabKeys.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tab, keys]) => {
      const inSections = new Set(sectionList.filter(s => s.tab === tab).flatMap(s => [s.titleKey, ...s.keys]));
      return [tab, [...keys].filter(k => !inSections.has(k)).sort()];
    })
    .filter(([, keys]) => keys.length > 0),
);

const outDir = join(srcDir, 'generated');
mkdirSync(outDir, { recursive: true });

const out = `/** @generated — run: node scripts/generate-settings-search-index.mjs */
export interface GeneratedSettingsSection {
  tab: string;
  /** Translation key of the heading; \`title\` holds literal headings instead. */
  titleKey?: string;
  title?: string;
  /** Only rendered while Advanced Mode is on. */
  advanced?: boolean;
  /** Translation keys rendered inside the section. */
  keys: readonly string[];
}

export const SETTINGS_SEARCH_SECTIONS: readonly GeneratedSettingsSection[] = ${JSON.stringify(sectionList, null, 2)};

/** Translation keys a tab renders outside of any section. */
export const SETTINGS_SEARCH_TAB_KEYS: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(tabKeyObject, null, 2)};
`;

writeFileSync(join(outDir, 'settingsSearchIndex.ts'), out, 'utf8');
const keyCount = sectionList.reduce((n, s) => n + s.keys.length, 0);
console.log(
  `wrote ${relative(root, join(outDir, 'settingsSearchIndex.ts')).split(sep).join('/')} `
  + `(${sectionList.length} sections, ${keyCount} section keys, ${tabRoots.length} tabs)`,
);
