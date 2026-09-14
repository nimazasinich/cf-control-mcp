import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('deploy config verifier allows an empty origin as degraded while validating configured HTTPS origins', async () => {
  const actual = spawnSync(process.execPath, ['scripts/verify-deploy-config.mjs'], { encoding: 'utf8' });
  assert.equal(actual.status, 0, actual.stderr || actual.stdout);
  assert.match(actual.stdout, /DEPLOY CONFIG PASS/);
  assert.match(actual.stdout, /OmniRoute origin: not configured/i);
  assert.match(actual.stdout, /inference/i);

  const dir = await mkdtemp(join(tmpdir(), 'omniroute-deploy-gate-'));
  const path = join(dir, 'wrangler.toml');
  const source = await readFile('wrangler.toml', 'utf8');

  const configured = source.replace('OMNIROUTE_ORIGIN = ""', 'OMNIROUTE_ORIGIN = "https://omniroute.internal.example"');
  await writeFile(path, configured);
  const checked = spawnSync(process.execPath, ['scripts/verify-deploy-config.mjs', path], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.match(checked.stdout, /DEPLOY CONFIG PASS/);
  assert.match(checked.stdout, /Routing authority: omniroute/);

  const insecure = source.replace('OMNIROUTE_ORIGIN = ""', 'OMNIROUTE_ORIGIN = "http://omniroute.internal.example"');
  await writeFile(path, insecure);
  const rejected = spawnSync(process.execPath, ['scripts/verify-deploy-config.mjs', path], { encoding: 'utf8' });
  await rm(dir, { recursive: true, force: true });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /must use https:/);
});

test('production deploy command is fail-closed and targets the existing Worker', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(packageJson.scripts['deploy:production'], 'node scripts/deploy-production.mjs');
  const source = await readFile('scripts/deploy-production.mjs', 'utf8');
  for (const marker of [
    "WORKER_NAME = 'omniroute-edge'",
    "npm, ['run', 'verify:deploy-config']",
    'Inference remains BLOCKED: OMNIROUTE_ORIGIN is not configured.',
    'Remote D1 migration state',
    "npm, ['run', 'build']",
    "'deploy', '--dry-run'",
    "'/api/auth/status'",
    "'/api/v2/providers?limit=1'",
    "'/v1/models'",
  ]) {
    assert.ok(source.includes(marker), `deploy-production.mjs must contain ${marker}`);
  }
  assert.doesNotMatch(source, /Bearer\s+[A-Za-z0-9_-]{16,}/);
});

test('Windows replacement workflow runs the full dependency-backed verification before build/deploy', async () => {
  const source = await readFile('VERIFY-AND-BUILD.cmd', 'utf8');
  for (const marker of ['npm ci', 'npm run lint', 'npm test', 'npm run build', 'npm run test:node', 'npm run verify:safety']) {
    assert.ok(source.includes(marker), `VERIFY-AND-BUILD.cmd must contain ${marker}`);
  }
});
