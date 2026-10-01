#!/usr/bin/env bash
set -euo pipefail

# Release hashes from the publisher's gitleaks_8.28.0_checksums.txt.
# Keep this version and its checksums together when upgrading.
version=8.28.0
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform=linux_x64; checksum=a65b5253807a68ac0cafa4414031fd740aeb55f54fb7e55f386acb52e6a840eb ;;
  Linux-aarch64|Linux-arm64) platform=linux_arm64; checksum=eff65261156100e5d94a6b3dec313d532fddfe19ae1590bf7a2b4f2699128356 ;;
  Darwin-x86_64) platform=darwin_x64; checksum=edf5a507008b0d2ef4959575772772770586409c1f6f74dabf19cbe7ec341ced ;;
  Darwin-arm64) platform=darwin_arm64; checksum=d942f3ad147250c9edbaab3fed9e482f98d3b59ba10ae97b8d75647e3ade492c ;;
  *) printf '%s\n' 'Secret scanning supports Linux and macOS on x64 or arm64.' >&2; exit 1 ;;
esac

scan_tmp=$(mktemp -d)
trap 'rm -rf "$scan_tmp"' EXIT
archive="gitleaks_${version}_${platform}.tar.gz"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "https://github.com/gitleaks/gitleaks/releases/download/v${version}/${archive}" \
  --output "$scan_tmp/$archive"
node --input-type=module - "$scan_tmp/$archive" "$checksum" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const [file, expected] = process.argv.slice(2);
if (createHash('sha256').update(readFileSync(file)).digest('hex') !== expected) {
  console.error('Gitleaks release checksum did not match. Nothing was executed.');
  process.exit(1);
}
NODE
tar -xzf "$scan_tmp/$archive" -C "$scan_tmp" gitleaks

repo_root=$(git rev-parse --show-toplevel)
if [ "$(git -C "$repo_root" rev-parse --is-shallow-repository)" = true ]; then
  printf '%s\n' 'Full git history is required. Run git fetch --unshallow before scanning.' >&2
  exit 1
fi

# Explicit additive config and empty ignore file prevent local exclusions.
touch "$scan_tmp/ignore"
flags=(--no-banner --no-color --redact=100 --ignore-gitleaks-allow \
  --config "$repo_root/scripts/secret-scan.toml" --gitleaks-ignore-path "$scan_tmp/ignore")
node "$repo_root/scripts/secret-scan-self-test.mjs" "$scan_tmp/gitleaks" "$repo_root/scripts/secret-scan.toml" "$scan_tmp/ignore"

# Include unstaged edits and new, nonignored files in the local check. Read
# symlink targets as text, as git does, without following them outside the repo.
node --input-type=module - "$repo_root" "$scan_tmp/working" <<'NODE'
import { execFileSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const [root, snapshot] = process.argv.slice(2);
mkdirSync(snapshot);
const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
for (const file of new Set(paths.split('\0').filter(Boolean))) {
  const source = join(root, file);
  let stat;
  try { stat = lstatSync(source); } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  const target = join(snapshot, file);
  mkdirSync(dirname(target), { recursive: true });
  if (stat.isSymbolicLink()) writeFileSync(target, readlinkSync(source));
  else if (stat.isFile()) copyFileSync(source, target);
}
NODE

"$scan_tmp/gitleaks" dir "${flags[@]}" "$scan_tmp/working"
"$scan_tmp/gitleaks" git "${flags[@]}" --log-opts=--all "$repo_root"
