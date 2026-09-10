import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const scriptUrl = new URL('./deploy-flatpak-ssh.sh', import.meta.url);
const scriptPath = fileURLToPath(scriptUrl);
const script = readFileSync(scriptUrl, 'utf8');
const publishWorkflow = readFileSync(new URL('../.github/workflows/flatpak-release.yml', import.meta.url), 'utf8');
const diagnosticWorkflow = readFileSync(
  new URL('../.github/workflows/flatpak-ssh-diagnostics.yml', import.meta.url),
  'utf8',
);

function writeExecutable(path, body) {
  writeFileSync(path, body, { mode: 0o755 });
}

function createDeploymentHarness(testContext, curlSucceeds, channels = ['stable', 'rc']) {
  const root = mkdtempSync(join(tmpdir(), 'psysonic-flatpak-deploy-'));
  const fakeBin = join(root, 'bin');
  const publish = join(root, 'publish');
  const remote = join(root, 'remote');
  const flatpakLog = join(root, 'flatpak.log');
  const publicKey = join(root, 'public.gpg');
  testContext.after(() => rmSync(root, { force: true, recursive: true }));

  mkdirSync(fakeBin);
  mkdirSync(remote);
  writeFileSync(publicKey, 'test public key');

  for (const channel of new Set(['stable', 'rc', ...channels])) {
    mkdirSync(join(publish, channel, 'repo'), { recursive: true });
    writeFileSync(join(publish, channel, 'repo', 'summary'), 'summary');
    writeFileSync(join(publish, channel, 'repo', 'summary.sig'), 'signature');
    writeFileSync(join(publish, channel, 'release.json'), '{}');
    writeFileSync(join(publish, channel, 'psysonic.flatpakref'), '[Flatpak Ref]');
    writeFileSync(join(publish, channel, 'new.txt'), `new ${channel}`);

    mkdirSync(join(remote, channel));
    writeFileSync(join(remote, channel, 'old.txt'), `old ${channel}`);
  }

  writeExecutable(
    join(fakeBin, 'ssh-keygen'),
    String.raw`#!/usr/bin/env bash
exit 0
`,
  );
  writeExecutable(
    join(fakeBin, 'ssh'),
    String.raw`#!/usr/bin/env bash
set -euo pipefail
while (($#)); do
  case "$1" in
    -i|-p|-o) shift 2 ;;
    *) break ;;
  esac
done
shift
if [[ "$1" == whoami ]]; then
  printf '%s\n' "$OSTREE_SSH_USER"
elif [[ "$1" == bash && "$2" == -s ]]; then
  shift 2
  exec bash -s "$@"
else
  exec bash -c "$1"
fi
`,
  );
  writeExecutable(
    join(fakeBin, 'scp'),
    String.raw`#!/usr/bin/env bash
set -euo pipefail
while (($#)); do
  case "$1" in
    -i|-P|-o) shift 2 ;;
    -r) shift ;;
    *) break ;;
  esac
done
source=$1
destination=$(printf '%s\n' "$2" | cut -d: -f2-)
cp -R -- "$source" "$destination"
`,
  );
  writeExecutable(
    join(fakeBin, 'curl'),
    String.raw`#!/usr/bin/env bash
if [[ "$FAKE_CURL_SUCCEEDS" == true ]]; then
  exit 0
fi
exit 22
`,
  );
  writeExecutable(
    join(fakeBin, 'flatpak'),
    String.raw`#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_FLATPAK_LOG"
if [[ "$1" == remote-info ]]; then
  printf '%s\n' deadbeef
fi
`,
  );
  writeExecutable(
    join(fakeBin, 'sleep'),
    String.raw`#!/usr/bin/env bash
exit 0
`,
  );

  return {
    flatpakLog,
    remote,
    result: spawnSync('bash', [scriptPath, 'deploy'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        DEPLOY_CHANNELS: channels.join(' '),
        FAKE_CURL_SUCCEEDS: String(curlSucceeds),
        FAKE_FLATPAK_LOG: flatpakLog,
        FLATPAK_ID: 'io.github.psysonic.psysonic',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_RUN_ID: '42',
        GPG_PUBLIC_KEY: publicKey,
        OSTREE_SSH_HOST: 'flatpak.example.test',
        OSTREE_SSH_KNOWN_HOSTS: 'flatpak.example.test ssh-ed25519 test',
        OSTREE_SSH_PATH: remote,
        OSTREE_SSH_PORT: '22',
        OSTREE_SSH_PRIVATE_KEY: 'test private key',
        OSTREE_SSH_USER: 'flatpak-deploy',
        PATH: `${fakeBin}:${process.env.PATH}`,
        PUBLIC_BASE_URL: 'https://flatpak.example.test',
        RUNNER_TEMP: root,
      },
    }),
  };
}

describe('Flatpak SSH deployment', () => {
  it('has valid Bash syntax', () => {
    execFileSync('bash', ['-n', scriptPath]);
  });

  it('uses strict known-host and identity verification for SSH and SCP', () => {
    assert.match(script, /StrictHostKeyChecking=yes/g);
    assert.match(script, /UserKnownHostsFile=/g);
    assert.match(script, /IdentitiesOnly=yes/g);
    assert.match(script, /ssh-keygen -y -P ''/);
  });

  it('uploads staging content with SCP and retains rollback until verification succeeds', () => {
    assert.match(script, /"\$\{SCP\[@\]\}" -r "publish\/\$channel\/\."/);
    assert.match(script, /remote_rollback/);
    assert.match(script, /CUTOVER_COMPLETE=true/);
    assert.match(script, /flatpak remote-info --user --show-commit/);
    assert.ok(script.indexOf('CUTOVER_COMPLETE=true') < script.lastIndexOf('previous-$suffix'));
  });

  it('uses the six configured SSH secrets and no FTP credentials', () => {
    for (const name of [
      'OSTREE_SSH_HOST',
      'OSTREE_SSH_KNOWN_HOSTS',
      'OSTREE_SSH_PATH',
      'OSTREE_SSH_PORT',
      'OSTREE_SSH_PRIVATE_KEY',
      'OSTREE_SSH_USER',
    ]) {
      assert.match(publishWorkflow, new RegExp(`secrets\\.${name}`));
      assert.match(diagnosticWorkflow, new RegExp(`secrets\\.${name}`));
    }
    assert.doesNotMatch(publishWorkflow, /OSTREE_FTP|lftp/);
  });

  it('retains bounded release history while keeping the test channel ephemeral', () => {
    assert.match(publishWorkflow, /apt-get install -y[^\n]*\bostree\b/);
    assert.match(publishWorkflow, /stable\) REPO_HISTORY_DEPTH=4/);
    assert.match(publishWorkflow, /rc\) REPO_HISTORY_DEPTH=2/);
    assert.match(publishWorkflow, /test\) REPO_HISTORY_DEPTH=0/);
    assert.match(publishWorkflow, /if \[ "\$CHANNEL" != test \]/);
    assert.match(publishWorkflow, /200\) REPO_SEED_URL="\$REPO_URL"/);
    assert.match(publishWorkflow, /GPG_KEYS="\$GPG_PUBLIC_KEY"/);
    assert.match(publishWorkflow, /REPO_HISTORY_DEPTH="\$REPO_HISTORY_DEPTH"/);
    assert.match(publishWorkflow, /REPO_SEED_URL="\$REPO_SEED_URL"/);
  });

  it('keeps the diagnostic workflow non-release and cleanup-oriented', () => {
    assert.match(diagnosticWorkflow, /workflow_dispatch/);
    assert.match(diagnosticWorkflow, /deploy-flatpak-ssh\.sh diagnose/);
    assert.doesNotMatch(diagnosticWorkflow, /release_tag|Flatpak Publish/);
  });

  it('commits both channels only after signed remote verification succeeds', (testContext) => {
    const { flatpakLog, remote, result } = createDeploymentHarness(testContext, true);

    assert.equal(result.status, 0, result.stderr);
    for (const channel of ['stable', 'rc']) {
      assert.equal(readFileSync(join(remote, channel, 'new.txt'), 'utf8'), `new ${channel}`);
      assert.equal(existsSync(join(remote, channel, 'old.txt')), false);
      assert.equal(existsSync(join(remote, `.${channel}-next-42-1`)), false);
      assert.equal(existsSync(join(remote, `.${channel}-previous-42-1`)), false);
    }

    const verificationCalls = readFileSync(flatpakLog, 'utf8');
    assert.match(verificationCalls, /remote-info .*io\.github\.psysonic\.psysonic\/\/stable/);
    assert.match(verificationCalls, /remote-info .*io\.github\.psysonic\.psysonic\/\/rc/);
  });

  it('publishes the test channel without replacing stable or rc', (testContext) => {
    const { flatpakLog, remote, result } = createDeploymentHarness(testContext, true, ['test']);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(remote, 'test', 'new.txt'), 'utf8'), 'new test');
    for (const channel of ['stable', 'rc']) {
      assert.equal(readFileSync(join(remote, channel, 'old.txt'), 'utf8'), `old ${channel}`);
      assert.equal(existsSync(join(remote, channel, 'new.txt')), false);
    }
    assert.match(
      readFileSync(flatpakLog, 'utf8'),
      /remote-info .*io\.github\.psysonic\.psysonic\/\/test/,
    );
  });

  it('restores every channel when public verification fails after cutover', (testContext) => {
    const { remote, result } = createDeploymentHarness(testContext, false);

    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /Published stable Flatpak repository did not become available/,
    );
    for (const channel of ['stable', 'rc']) {
      assert.equal(readFileSync(join(remote, channel, 'old.txt'), 'utf8'), `old ${channel}`);
      assert.equal(existsSync(join(remote, channel, 'new.txt')), false);
      assert.equal(existsSync(join(remote, `.${channel}-next-42-1`)), false);
      assert.equal(existsSync(join(remote, `.${channel}-previous-42-1`)), false);
    }
  });
});
