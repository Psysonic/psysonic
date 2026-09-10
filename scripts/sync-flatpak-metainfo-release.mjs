#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultMetainfoPath = resolve(
  root,
  'src-tauri/flatpak/io.github.psysonic.psysonic.metainfo.xml',
);

function assertReleaseVersion(version, allowDevelopment) {
  const pattern = allowDevelopment
    ? /^\d+\.\d+\.\d+(?:-rc\.\d+|-dev)?$/
    : /^\d+\.\d+\.\d+(?:-rc\.\d+)?$/;
  if (!pattern.test(version)) {
    throw new Error(`Flatpak AppStream release requires X.Y.Z or X.Y.Z-rc.N, got ${version}`);
  }
}

function assertReleaseDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Flatpak AppStream release date requires YYYY-MM-DD, got ${date}`);
  }
}

export function syncFlatpakMetainfoRelease(xml, version, date, options = {}) {
  const { allowDevelopment = false, detailsUrl } = options;
  assertReleaseVersion(version, allowDevelopment);
  assertReleaseDate(date);

  if (version.endsWith('-dev') && !detailsUrl) {
    throw new Error('Flatpak development release requires an explicit details URL');
  }

  if (xml.includes(`<release version="${version}"`)) {
    return { xml, changed: false };
  }

  const release = [
    `    <release version="${version}" date="${date}">`,
    `      <url type="details">${detailsUrl ?? `https://github.com/Psysonic/psysonic/releases/tag/app-v${version}`}</url>`,
    '    </release>',
  ].join('\n');
  const marker = '  <releases>\n';
  if (!xml.includes(marker)) {
    throw new Error('Flatpak metainfo has no <releases> insertion point');
  }

  return {
    xml: xml.replace(marker, `${marker}${release}\n`),
    changed: true,
  };
}

function main() {
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const version = process.env.PSYSONIC_FLATPAK_VERSION ?? packageJson.version;
  const date = process.env.PSYSONIC_RELEASE_DATE ?? new Date().toISOString().slice(0, 10);
  const metainfoPath = resolve(
    root,
    process.env.PSYSONIC_FLATPAK_METAINFO_PATH ?? defaultMetainfoPath,
  );
  const original = readFileSync(metainfoPath, 'utf8');
  const result = syncFlatpakMetainfoRelease(original, version, date, {
    allowDevelopment: process.env.PSYSONIC_FLATPAK_ALLOW_DEVELOPMENT === 'true',
    detailsUrl: process.env.PSYSONIC_FLATPAK_DETAILS_URL,
  });
  if (!result.changed) {
    console.log(`Flatpak metainfo already contains ${version}`);
    return;
  }
  writeFileSync(metainfoPath, result.xml);
  console.log(`Flatpak metainfo -> ${version} (${date})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
