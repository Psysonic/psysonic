#!/usr/bin/env node

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const manifestName = 'io.github.psysonic.psysonic.yaml';
const desktopName = 'io.github.psysonic.psysonic.desktop';
const metainfoName = 'io.github.psysonic.psysonic.metainfo.xml';

function replaceRequired(source, pattern, replacement, description) {
  if (!pattern.test(source)) {
    throw new Error(`Flatpak packaging has no ${description} insertion point`);
  }
  return source.replace(pattern, replacement);
}

export function prepareFlatpakPackaging({ packagingDir, sourceDir, sourceSha }) {
  if (!/^[0-9a-f]{40}$/i.test(sourceSha)) {
    throw new Error(`Flatpak source SHA must be an exact 40-character commit SHA, got ${sourceSha}`);
  }

  const manifestPath = resolve(packagingDir, manifestName);
  const makefilePath = resolve(packagingDir, 'Makefile');
  const manifest = replaceRequired(
    readFileSync(manifestPath, 'utf8'),
    /(^\s*url:\s+https:\/\/github\.com\/Psysonic\/psysonic\.git[ \t]*$\n^\s*commit:\s*)[0-9a-f]{40}[ \t]*$/m,
    `$1${sourceSha}`,
    'Psysonic manifest source',
  );
  const makefile = replaceRequired(
    readFileSync(makefilePath, 'utf8'),
    /^(COMMIT_HASH\s*(?::|\?|\+)?=\s*)[0-9a-f]{40}[ \t]*$/m,
    `$1${sourceSha}`,
    'COMMIT_HASH',
  );

  writeFileSync(manifestPath, manifest);
  writeFileSync(makefilePath, makefile);
  copyFileSync(resolve(sourceDir, 'src-tauri/flatpak', desktopName), resolve(packagingDir, desktopName));
  copyFileSync(resolve(sourceDir, 'src-tauri/flatpak', metainfoName), resolve(packagingDir, metainfoName));
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument ${name}`);
  }
  return process.argv[index + 1];
}

function main() {
  const packagingDir = resolve(argumentValue('--packaging-dir'));
  const sourceDir = resolve(argumentValue('--source-dir'));
  const sourceSha = argumentValue('--source-sha');
  prepareFlatpakPackaging({ packagingDir, sourceDir, sourceSha });
  console.log(`Flatpak packaging prepared for ${sourceSha}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
