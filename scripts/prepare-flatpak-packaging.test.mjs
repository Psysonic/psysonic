import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareFlatpakPackaging } from './prepare-flatpak-packaging.mjs';

describe('prepareFlatpakPackaging', () => {
  it('pins the selected source and copies canonical desktop metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'psysonic-flatpak-'));
    const packagingDir = join(root, 'flatpak');
    const sourceDir = join(root, 'app');
    const metadataDir = join(sourceDir, 'src-tauri', 'flatpak');
    const sourceSha = '1234567890abcdef1234567890abcdef12345678';

    try {
      mkdirSync(packagingDir, { recursive: true });
      mkdirSync(metadataDir, { recursive: true });
      writeFileSync(
        join(packagingDir, 'io.github.psysonic.psysonic.yaml'),
        'sources:\n  - type: git\n    url: https://github.com/Psysonic/psysonic.git\n    commit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
      );
      writeFileSync(join(packagingDir, 'Makefile'), `COMMIT_HASH = ${'a'.repeat(40)}\n`);
      writeFileSync(join(metadataDir, 'io.github.psysonic.psysonic.desktop'), '[Desktop Entry]\n');
      writeFileSync(join(metadataDir, 'io.github.psysonic.psysonic.metainfo.xml'), '<component/>\n');

      prepareFlatpakPackaging({ packagingDir, sourceDir, sourceSha });

      assert.match(
        readFileSync(join(packagingDir, 'io.github.psysonic.psysonic.yaml'), 'utf8'),
        new RegExp(`commit: ${sourceSha}`),
      );
      assert.equal(readFileSync(join(packagingDir, 'Makefile'), 'utf8'), `COMMIT_HASH = ${sourceSha}\n`);
      assert.equal(
        readFileSync(join(packagingDir, 'io.github.psysonic.psysonic.desktop'), 'utf8'),
        '[Desktop Entry]\n',
      );
      assert.equal(
        readFileSync(join(packagingDir, 'io.github.psysonic.psysonic.metainfo.xml'), 'utf8'),
        '<component/>\n',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects an invalid source SHA before editing files', () => {
    assert.throws(
      () => prepareFlatpakPackaging({ packagingDir: '.', sourceDir: '.', sourceSha: 'main' }),
      /exact 40-character commit SHA/,
    );
  });
});
