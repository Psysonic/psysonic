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

  it('generates development metadata only with an explicit commit URL', () => {
    const detailsUrl = 'https://github.com/Psysonic/psysonic/commit/0123456789abcdef';
    const result = syncFlatpakMetainfoRelease(base, '1.54.0-dev', '2026-09-10', {
      allowDevelopment: true,
      detailsUrl,
    });

    assert.equal(result.changed, true);
    assert.match(result.xml, /<release version="1\.54\.0-dev" date="2026-09-10">/);
    assert.ok(result.xml.includes(`<url type="details">${detailsUrl}</url>`));
    assert.ok(result.xml.indexOf('1.54.0-dev') < result.xml.indexOf('1.52.0'));
  });

  it('rejects development metadata without a details URL', () => {
    assert.throws(
      () => syncFlatpakMetainfoRelease(base, '1.54.0-dev', '2026-09-10', {
        allowDevelopment: true,
      }),
      /requires an explicit details URL/,
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
  it('starts automatically when a prepared GitHub Release is published', () => {
    const source = readFileSync(new URL('../.github/workflows/flatpak-release.yml', import.meta.url), 'utf8');

    assert.match(source, /release:\s*\n\s*types: \[published\]/);
    assert.match(source, /inputs\.release_tag \|\| github\.event\.release\.tag_name/);
    assert.match(source, /workflow_dispatch:/);
  });

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

  it('generates test AppStream metadata from the checked-out package version', () => {
    const source = readFileSync(new URL('../.github/workflows/flatpak-release.yml', import.meta.url), 'utf8');
    const generation = source.indexOf('PSYSONIC_FLATPAK_ALLOW_DEVELOPMENT=true');
    const validation = source.indexOf('appstreamcli validate --pedantic');
    const build = source.indexOf('make build');

    assert.ok(generation >= 0, 'test publication must generate development AppStream metadata');
    assert.ok(generation < validation, 'AppStream metadata must be generated before validation');
    assert.ok(generation < build, 'AppStream metadata must be generated before the Flatpak build');
    assert.match(source, /PSYSONIC_FLATPAK_VERSION="\$PACKAGE_VERSION"/);
    assert.match(source, /commit\/\$EXPECTED_SHA/);
    assert.doesNotMatch(source, /\[ "\$IS_TEST" = false \] && ! grep/);
  });
});

describe('GitHub artifact action runtime', () => {
  for (const workflow of [
    'flatpak-release.yml',
    'frontend-tests.yml',
    'linux-bundle-test.yml',
    'macos-bundle-test.yml',
    'rust-tests.yml',
  ]) {
    it(`${workflow} uses the Node 24 artifact action`, () => {
      const source = readFileSync(new URL(`../.github/workflows/${workflow}`, import.meta.url), 'utf8');

      assert.match(source, /actions\/upload-artifact@v7/);
      assert.doesNotMatch(source, /actions\/upload-artifact@v4/);
    });
  }
});
