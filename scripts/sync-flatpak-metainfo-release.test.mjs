import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { syncFlatpakMetainfoRelease } from './sync-flatpak-metainfo-release.mjs';

const base = `  <releases>
    <release version="1.52.0" date="2026-08-31">
      <url type="details">https://github.com/Psysonic/psysonic/releases/tag/app-v1.52.0</url>
    </release>
  </releases>
`;

describe('syncFlatpakMetainfoRelease', () => {
  it('inserts the promoted release before prior entries', () => {
    const result = syncFlatpakMetainfoRelease(base, '1.53.0-rc.1', '2026-09-10');

    assert.equal(result.changed, true);
    assert.match(result.xml, /<release version="1\.53\.0-rc\.1" date="2026-09-10">/);
    assert.ok(result.xml.indexOf('1.53.0-rc.1') < result.xml.indexOf('1.52.0'));
    assert.match(result.xml, /releases\/tag\/app-v1\.53\.0-rc\.1/);
  });

  it('is idempotent when the version already exists', () => {
    const first = syncFlatpakMetainfoRelease(base, '1.53.0', '2026-09-10');
    const second = syncFlatpakMetainfoRelease(first.xml, '1.53.0', '2026-09-11');

    assert.equal(second.changed, false);
    assert.equal(second.xml, first.xml);
  });

  it('rejects development versions that cannot be published', () => {
    assert.throws(
      () => syncFlatpakMetainfoRelease(base, '1.54.0-dev', '2026-09-10'),
      /requires X\.Y\.Z or X\.Y\.Z-rc\.N/,
    );
  });
});

describe('Flatpak release promotion wiring', () => {
  for (const workflow of ['promote-main-to-next.yml', 'promote-next-to-release.yml']) {
    it(`${workflow} commits the generated AppStream entry`, () => {
      const source = readFileSync(new URL(`../.github/workflows/${workflow}`, import.meta.url), 'utf8');
      const syncCall = source.indexOf('node scripts/sync-flatpak-metainfo-release.mjs');
      const commitStep = source.indexOf('git commit -m');

      assert.ok(syncCall >= 0, `${workflow} must run the Flatpak metainfo sync`);
      assert.ok(syncCall < commitStep, `${workflow} must sync metainfo before committing`);
      assert.match(source, /git add[\s\S]*src-tauri\/flatpak\/io\.github\.psysonic\.psysonic\.metainfo\.xml/);
    });
  }
});

describe('Flatpak signing continuity wiring', () => {
  it('requires and compares the configured full fingerprint', () => {
    const source = readFileSync(new URL('../.github/workflows/flatpak-release.yml', import.meta.url), 'utf8');

    assert.match(source, /vars\.OSTREE_GPG_FINGERPRINT/);
    assert.match(source, /ACTUAL_FINGERPRINT/);
    assert.match(source, /ACTUAL_FINGERPRINT" != "\$EXPECTED_FINGERPRINT/);
  });
});

describe('Flatpak build dependencies', () => {
  it('installs both the application runtime and build SDK', () => {
    const source = readFileSync(new URL('../.github/workflows/flatpak-release.yml', import.meta.url), 'utf8');

    assert.match(source, /org\.gnome\.Platform\/\/50/);
    assert.match(source, /org\.gnome\.Sdk\/\/50/);
  });
});

describe('Flatpak GitHub Release publication gate', () => {
  it('rejects draft or unpublished releases before deployment planning', () => {
    const source = readFileSync(new URL('../.github/workflows/flatpak-release.yml', import.meta.url), 'utf8');
    const releaseGate = source.indexOf('must be publicly published before its Flatpak channel can update');
    const deploymentPlan = source.indexOf('- name: plan channel deployment');

    assert.match(source, /--json isDraft,isPrerelease,publishedAt/);
    assert.match(source, /\.isDraft == false/);
    assert.match(source, /\.publishedAt != null/);
    assert.ok(releaseGate >= 0, 'workflow must reject an unpublished GitHub Release');
    assert.ok(releaseGate < deploymentPlan, 'release publication must be checked before deployment planning');
  });

  it('keeps test publication separate from release assets and production channels', () => {
    const source = readFileSync(new URL('../.github/workflows/flatpak-release.yml', import.meta.url), 'utf8');

    assert.match(source, /test_source_sha must be an exact 40-character commit SHA/);
    assert.match(source, /test_source_sha \$TEST_SOURCE_SHA is not current main \$CURRENT_MAIN_SHA/);
    assert.match(source, /if \[ "\$PRIMARY_CHANNEL" = test \]/);
    assert.match(source, /if: steps\.release\.outputs\.is_test != 'true'/);
    assert.match(source, /publish\/test\/psysonic\.flatpakref/);
  });
});
