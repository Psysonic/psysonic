#!/usr/bin/env bash

set -Eeuo pipefail

MODE="${1:-}"
if [[ "$MODE" != "diagnose" && "$MODE" != "deploy" ]]; then
  echo "Usage: $0 diagnose|deploy" >&2
  exit 2
fi

required=(
  OSTREE_SSH_HOST
  OSTREE_SSH_KNOWN_HOSTS
  OSTREE_SSH_PATH
  OSTREE_SSH_PORT
  OSTREE_SSH_PRIVATE_KEY
  OSTREE_SSH_USER
  PUBLIC_BASE_URL
  RUNNER_TEMP
  GITHUB_RUN_ID
  GITHUB_RUN_ATTEMPT
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "::error::$name is not configured"
    exit 1
  fi
done

if [[ ! "$OSTREE_SSH_HOST" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "::error::OSTREE_SSH_HOST must be a hostname or IPv4 address"
  exit 1
fi
if [[ ! "$OSTREE_SSH_PORT" =~ ^[0-9]+$ ]] || (( OSTREE_SSH_PORT < 1 || OSTREE_SSH_PORT > 65535 )); then
  echo "::error::OSTREE_SSH_PORT must be between 1 and 65535"
  exit 1
fi
if [[ ! "$OSTREE_SSH_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  echo "::error::OSTREE_SSH_USER is invalid"
  exit 1
fi
if [[ ! "$OSTREE_SSH_PATH" =~ ^/[A-Za-z0-9._/-]+$ ]] || [[ "$OSTREE_SSH_PATH" == *".."* ]]; then
  echo "::error::OSTREE_SSH_PATH must be a safe absolute path"
  exit 1
fi

SSH_DIR="$RUNNER_TEMP/flatpak-ssh"
SSH_KEY="$SSH_DIR/id"
KNOWN_HOSTS="$SSH_DIR/known_hosts"
TARGET="$OSTREE_SSH_USER@$OSTREE_SSH_HOST"
mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"
printf '%s\n' "$OSTREE_SSH_PRIVATE_KEY" | tr -d '\r' > "$SSH_KEY"
printf '%s\n' "$OSTREE_SSH_KNOWN_HOSTS" | tr -d '\r' > "$KNOWN_HOSTS"
chmod 600 "$SSH_KEY" "$KNOWN_HOSTS"

SSH=(
  ssh
  -i "$SSH_KEY"
  -p "$OSTREE_SSH_PORT"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="$KNOWN_HOSTS"
)
SCP=(
  scp
  -i "$SSH_KEY"
  -P "$OSTREE_SSH_PORT"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="$KNOWN_HOSTS"
)

remove_ssh_material() {
  rm -rf "$SSH_DIR"
}
trap remove_ssh_material EXIT

ssh-keygen -y -P '' -f "$SSH_KEY" >/dev/null
REMOTE_USER="$("${SSH[@]}" "$TARGET" whoami)"
if [[ "$REMOTE_USER" != "$OSTREE_SSH_USER" ]]; then
  echo "::error::SSH authenticated as $REMOTE_USER instead of the configured deploy account"
  remove_ssh_material
  exit 1
fi
if ! "${SSH[@]}" "$TARGET" "test -d '$OSTREE_SSH_PATH' && test -w '$OSTREE_SSH_PATH'"; then
  echo "::error::The deploy account cannot write to OSTREE_SSH_PATH"
  remove_ssh_material
  exit 1
fi

if [[ "$MODE" == "diagnose" ]]; then
  TEST_BODY='Flatpak GitHub Actions SSH upload test'
  LOCAL_FILE="$SSH_DIR/upload-test.txt"
  REMOTE_NAME="ssh-upload-test-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT.txt"
  REMOTE_FILE="$OSTREE_SSH_PATH/$REMOTE_NAME"
  UPLOADED=false

  # shellcheck disable=SC2329
  cleanup_diagnostic() {
    status=$?
    trap - EXIT
    if [[ "$UPLOADED" == true ]]; then
      "${SSH[@]}" "$TARGET" "rm -f -- '$REMOTE_FILE'" || true
    fi
    remove_ssh_material
    exit "$status"
  }
  trap cleanup_diagnostic EXIT

  printf '%s\n' "$TEST_BODY" > "$LOCAL_FILE"
  "${SCP[@]}" "$LOCAL_FILE" "$TARGET:$REMOTE_FILE"
  UPLOADED=true
  DOWNLOADED="$(curl --fail --show-error --silent --retry 3 --retry-all-errors --max-time 30 \
    "$PUBLIC_BASE_URL/$REMOTE_NAME")"
  if [[ "$DOWNLOADED" != "$TEST_BODY" ]]; then
    echo "::error::The HTTPS response did not match the SCP upload"
    exit 1
  fi
  "${SSH[@]}" "$TARGET" "rm -- '$REMOTE_FILE'"
  UPLOADED=false
  echo "SSH authentication, strict host verification, SCP upload, HTTPS retrieval and cleanup passed."
  exit 0
fi

deploy_required=(DEPLOY_CHANNELS FLATPAK_ID GPG_PUBLIC_KEY)
for name in "${deploy_required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "::error::$name is not configured"
    remove_ssh_material
    exit 1
  fi
done
if [[ ! -s "$GPG_PUBLIC_KEY" ]]; then
  echo "::error::GPG_PUBLIC_KEY does not point to the exported repository key"
  remove_ssh_material
  exit 1
fi

read -r -a CHANNELS <<< "$DEPLOY_CHANNELS"
if (( ${#CHANNELS[@]} == 0 )); then
  echo "::error::DEPLOY_CHANNELS is empty"
  remove_ssh_material
  exit 1
fi
for channel in "${CHANNELS[@]}"; do
  if [[ "$channel" != "stable" && "$channel" != "rc" ]]; then
    echo "::error::Unsupported deployment channel: $channel"
    remove_ssh_material
    exit 1
  fi
  if [[ ! -d "publish/$channel/repo" ]]; then
    echo "::error::publish/$channel is missing"
    remove_ssh_material
    exit 1
  fi
done

deployment_suffix="$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
CUTOVER_COMPLETE=false

remote_rollback() {
  "${SSH[@]}" "$TARGET" bash -s -- "$OSTREE_SSH_PATH" "$deployment_suffix" "${CHANNELS[@]}" <<'REMOTE'
set -euo pipefail
root=$1
suffix=$2
shift 2
for channel in "$@"; do
  live="$root/$channel"
  staging="$root/.$channel-next-$suffix"
  backup="$root/.$channel-previous-$suffix"
  rm -rf -- "$live" "$staging"
  if [[ -e "$backup" ]]; then
    mv -- "$backup" "$live"
  fi
done
REMOTE
}

# shellcheck disable=SC2329
cleanup_deployment() {
  status=$?
  trap - EXIT
  for channel in "${CHANNELS[@]}"; do
    flatpak remote-delete --user --force "psysonic-verify-$channel-$deployment_suffix" >/dev/null 2>&1 || true
  done
  if (( status != 0 )); then
    if [[ "$CUTOVER_COMPLETE" == true ]]; then
      echo "::warning::Deployment failed after cutover; restoring every changed channel"
      remote_rollback || echo "::error::Automatic rollback failed; server backup directories were retained"
    else
      "${SSH[@]}" "$TARGET" bash -s -- "$OSTREE_SSH_PATH" "$deployment_suffix" "${CHANNELS[@]}" <<'REMOTE' || true
set -euo pipefail
root=$1
suffix=$2
shift 2
for channel in "$@"; do
  rm -rf -- "$root/.$channel-next-$suffix"
done
REMOTE
    fi
  fi
  remove_ssh_material
  exit "$status"
}
trap cleanup_deployment EXIT

for channel in "${CHANNELS[@]}"; do
  staging="$OSTREE_SSH_PATH/.$channel-next-$deployment_suffix"
  backup="$OSTREE_SSH_PATH/.$channel-previous-$deployment_suffix"
  "${SSH[@]}" "$TARGET" bash -s -- "$staging" "$backup" <<'REMOTE'
set -euo pipefail
staging=$1
backup=$2
rm -rf -- "$staging"
if [[ -e "$backup" ]]; then
  echo "A backup for this workflow attempt already exists: $backup" >&2
  exit 1
fi
mkdir -- "$staging"
REMOTE
  "${SCP[@]}" -r "publish/$channel/." "$TARGET:$staging/"
  "${SSH[@]}" "$TARGET" \
    "test -s '$staging/repo/summary' && test -s '$staging/repo/summary.sig' && test -s '$staging/release.json' && test -s '$staging/psysonic.flatpakref'"
done

"${SSH[@]}" "$TARGET" bash -s -- "$OSTREE_SSH_PATH" "$deployment_suffix" "${CHANNELS[@]}" <<'REMOTE'
set -Eeuo pipefail
root=$1
suffix=$2
shift 2
processed=()
rollback() {
  for channel in "${processed[@]}"; do
    live="$root/$channel"
    backup="$root/.$channel-previous-$suffix"
    rm -rf -- "$live"
    if [[ -e "$backup" ]]; then
      mv -- "$backup" "$live"
    fi
  done
}
trap rollback ERR INT TERM
for channel in "$@"; do
  live="$root/$channel"
  staging="$root/.$channel-next-$suffix"
  backup="$root/.$channel-previous-$suffix"
  processed=("$channel" "${processed[@]}")
  if [[ -e "$live" ]]; then
    mv -- "$live" "$backup"
  fi
  mv -- "$staging" "$live"
done
trap - ERR INT TERM
REMOTE
CUTOVER_COMPLETE=true

for channel in "${CHANNELS[@]}"; do
  repo_url="$PUBLIC_BASE_URL/$channel/repo/"
  flatpakref_url="$PUBLIC_BASE_URL/$channel/psysonic.flatpakref"
  for attempt in $(seq 1 12); do
    if curl --fail --silent --show-error "${repo_url}summary" >/dev/null \
      && curl --fail --silent --show-error "${repo_url}summary.sig" >/dev/null \
      && curl --fail --silent --show-error "$PUBLIC_BASE_URL/$channel/release.json" >/dev/null \
      && curl --fail --silent --show-error "$flatpakref_url" >/dev/null; then
      break
    fi
    if (( attempt == 12 )); then
      echo "::error::Published $channel Flatpak repository did not become available"
      exit 1
    fi
    sleep 5
  done

  verify_remote="psysonic-verify-$channel-$deployment_suffix"
  flatpak remote-delete --user --force "$verify_remote" >/dev/null 2>&1 || true
  flatpak remote-add --user --gpg-import="$GPG_PUBLIC_KEY" "$verify_remote" "$repo_url"
  remote_commit="$(flatpak remote-info --user --show-commit "$verify_remote" "$FLATPAK_ID//$channel")"
  if [[ -z "$remote_commit" ]]; then
    echo "::error::Signed remote verification returned no commit for $channel"
    exit 1
  fi
  flatpak remote-delete --user --force "$verify_remote" \
    || echo "::warning::Could not remove temporary verification remote $verify_remote"
done

CUTOVER_COMPLETE=false
if ! "${SSH[@]}" "$TARGET" bash -s -- "$OSTREE_SSH_PATH" "$deployment_suffix" "${CHANNELS[@]}" <<'REMOTE'
set -euo pipefail
root=$1
suffix=$2
shift 2
for channel in "$@"; do
  rm -rf -- "$root/.$channel-previous-$suffix" "$root/.$channel-next-$suffix"
done
REMOTE
then
  echo "::warning::Deployment passed verification, but remote backup cleanup failed"
fi
echo "SCP deployment and signed verification passed for: ${CHANNELS[*]}"
