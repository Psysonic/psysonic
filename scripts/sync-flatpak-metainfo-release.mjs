#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const metainfoPath = resolve(
  root,
  'src-tauri/flatpak/io.github.psysonic.psysonic.metainfo.xml',
);

function assertReleaseVersion(version) {
  if (!/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(version)) {
    throw new Error(`Flatpak AppStream release requires X.Y.Z or X.Y.Z-rc.N, got ${version}`);
  }
}

function assertReleaseDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Flatpak AppStream release date requires YYYY-MM-DD, got ${date}`);
  }
}

export function syncFlatpakMetainfoRelease(xml, version, date) {
  assertReleaseVersion(version);
  assertReleaseDate(date);

  if (xml.includes(`<release version="${version}"`)) {
    return { xml, changed: false };
  }

  const release = [
    `    <release version="${version}" date="${date}">`,
    `      <url type="details">https://github.com/Psysonic/psysonic/releases/tag/app-v${version}</url>`,
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
  const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const date = process.env.PSYSONIC_RELEASE_DATE ?? new Date().toISOString().slice(0, 10);
  const original = readFileSync(metainfoPath, 'utf8');
  const result = syncFlatpakMetainfoRelease(original, version, date);
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
