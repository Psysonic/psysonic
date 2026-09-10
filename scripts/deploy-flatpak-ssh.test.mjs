import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const scriptUrl = new URL('./deploy-flatpak-ssh.sh', import.meta.url);
const scriptPath = fileURLToPath(scriptUrl);
const script = readFileSync(scriptUrl, 'utf8');
const publishWorkflow = readFileSync(new URL('../.github/workflows/flatpak-release.yml', import.meta.url), 'utf8');
const diagnosticWorkflow = readFileSync(
  new URL('../.github/workflows/flatpak-ssh-diagnostics.yml', import.meta.url),
  'utf8',
);

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

  it('keeps the diagnostic workflow non-release and cleanup-oriented', () => {
    assert.match(diagnosticWorkflow, /workflow_dispatch/);
    assert.match(diagnosticWorkflow, /deploy-flatpak-ssh\.sh diagnose/);
    assert.doesNotMatch(diagnosticWorkflow, /release_tag|Flatpak Publish/);
  });
});
