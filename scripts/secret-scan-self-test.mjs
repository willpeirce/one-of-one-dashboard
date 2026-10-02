// This check creates synthetic credentials only in a disposable directory.
// It must detect both an uncommitted key and one deleted from git history.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [gitleaks, config, ignore] = process.argv.slice(2);
const directory = mkdtempSync(join(tmpdir(), 'pulse-scanner-test-'));
const report = join(directory, 'report.json');
const key = ['gh', 'p_', randomBytes(18).toString('hex')].join('');
const setupPhrase = Array.from(randomBytes(5), (value) => ['orbit', 'cloud', 'maple', 'stone'][value % 4]).join(' ');
const flags = ['--no-banner', '--no-color', '--redact=100', '--ignore-gitleaks-allow', '--config', config, '--gitleaks-ignore-path', ignore, '--report-format', 'json', '--report-path', report];
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 0, 'Synthetic scanner repository setup failed.');
};
function expectDetection(mode, rules = ['github-pat'], extra = []) {
  const result = spawnSync(gitleaks, [mode, ...flags, ...extra, directory], { encoding: 'utf8' });
  assert.equal(result.status, 1, 'Gitleaks must reject the synthetic credential.');
  // Do not put scanner output into assertion messages: these checks also
  // protect logs if a future scanner release breaks redaction.
  const serialized = readFileSync(report, 'utf8');
  assert.ok(!serialized.includes(key), 'The scanner report must redact credentials.');
  assert.ok(!serialized.includes(setupPhrase), 'The scanner report must redact setup phrases.');
  assert.ok(!result.stdout.includes(key) && !result.stderr.includes(key), 'The scanner output must redact credentials.');
  assert.ok(!result.stdout.includes(setupPhrase) && !result.stderr.includes(setupPhrase), 'The scanner output must redact setup phrases.');
  for (const rule of rules) assert.ok(JSON.parse(serialized).some((finding) => finding.RuleID === rule), 'Every expected credential rule must run.');
  rmSync(report);
}
try {
  writeFileSync(join(directory, 'credential.txt'), key);
  expectDetection('dir');
  writeFileSync(join(directory, 'setup.txt'), `${['DASHBOARD', 'SETUP', 'CODE'].join('_')} = '${setupPhrase}'\n`);
  writeFileSync(join(directory, 'setup-unquoted.txt'), `${['DASHBOARD', 'SETUP', 'CODE'].join('_')}=${setupPhrase}\n`);
  expectDetection('dir', ['github-pat', 'pulse-secret-literal', 'pulse-secret-dotenv']);
  rmSync(join(directory, 'setup.txt'));
  rmSync(join(directory, 'setup-unquoted.txt'));
  git('init', '--quiet');
  git('config', 'user.name', 'Scanner self-test');
  git('config', 'user.email', 'scanner@example.invalid');
  git('add', 'credential.txt');
  git('commit', '--quiet', '-m', 'Synthetic scanner check');
  git('rm', '--quiet', 'credential.txt');
  git('commit', '--quiet', '-m', 'Remove synthetic scanner check');
  expectDetection('git', ['github-pat'], ['--log-opts=--all']);
  console.log('Secret scanner self-test passed: keys, setup phrases, deleted history and redaction.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
