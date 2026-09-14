import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const WORKER_NAME = 'omniroute-edge';
const DATABASE_NAME = 'omniroute-edge-db';
const PRODUCTION_URL = 'https://omniroute-edge.amin-chinisaz-edu.workers.dev';
const WRANGLER_VERSION = '4.36.0';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const commandEnv = { ...process.env };
const wrangler = ['--yes', `wrangler@${WRANGLER_VERSION}`];

function run(label, command, args, options = {}) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...commandEnv, ...options.env },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: options.timeout ?? 10 * 60_000,
    shell: process.platform === 'win32',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? `exit code ${result.status}`;
    throw new Error(`${label} failed: ${reason}`);
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function envFileValue(name) {
  if (!existsSync(resolve(ROOT, '.env'))) return '';
  const line = readFileSync(resolve(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .find((candidate) => candidate.trimStart().startsWith(`${name}=`));
  if (!line) return '';
  return line.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
}

function configuredOrigin() {
  const source = readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8');
  return source.match(/^\s*OMNIROUTE_ORIGIN\s*=\s*"([^"]*)"/m)?.[1]?.trim() ?? '';
}

async function requireReachableOrigin() {
  const origin = configuredOrigin();
  if (!origin) {
    console.log('Inference remains BLOCKED: OMNIROUTE_ORIGIN is not configured. Control-plane deploy may proceed.');
    return false;
  }
  const url = new URL(origin);
  if (url.origin === PRODUCTION_URL) throw new Error('OMNIROUTE_ORIGIN must not point back to the Edge Worker.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(new URL('/v1/models', url), {
      headers: originToken() ? { Authorization: `Bearer ${originToken()}` } : {},
      redirect: 'manual',
      signal: controller.signal,
    });
    if (![200, 401, 403].includes(response.status)) {
      throw new Error(`origin /v1/models returned HTTP ${response.status}`);
    }
    console.log(`Origin reachability PASS: ${url.host} (HTTP ${response.status})`);
    return true;
  } catch (error) {
    throw new Error(`verified origin is not reachable: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

function originToken() {
  return process.env.OMNIROUTE_ORIGIN_TOKEN || envFileValue('OMNIROUTE_ORIGIN_TOKEN');
}

function parseJsonArray(output) {
  const start = output.indexOf('[');
  const end = output.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('Wrangler did not return a JSON result.');
  return JSON.parse(output.slice(start, end + 1));
}

function verifyRemoteMigrations() {
  const output = run(
    'Remote D1 migration state',
    npx,
    [...wrangler, 'd1', 'execute', DATABASE_NAME, '--remote', '--command', 'SELECT name FROM d1_migrations ORDER BY id;', '--json'],
    { timeout: 3 * 60_000 },
  );
  const payload = parseJsonArray(output);
  const rows = payload.flatMap((entry) => entry.results ?? []);
  const remote = rows.map((row) => row.name);
  const local = readdirSync(resolve(ROOT, 'drizzle')).filter((name) => name.endsWith('.sql')).sort();
  const missing = local.filter((name) => !remote.includes(name));
  if (missing.length) throw new Error(`remote D1 is missing migrations: ${missing.join(', ')}`);

  const historicalDuplicate = '0004_routing_decision_index.sql';
  const unexpected = remote.filter((name) => !local.includes(name) && name !== historicalDuplicate);
  if (unexpected.length) throw new Error(`remote D1 has unexpected migration records: ${unexpected.join(', ')}`);
  if (remote.includes(historicalDuplicate)) {
    console.log(`Migration warning: preserving historical remote record ${historicalDuplicate}.`);
  }
  console.log(`Remote D1 migration PASS: ${local.length}/${local.length} current migrations recorded.`);
}

async function expectJson(path, expectedStatus, check, headers = {}) {
  const response = await fetch(`${PRODUCTION_URL}${path}`, { headers, redirect: 'manual' });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${path} did not return JSON.`); }
  if (response.status !== expectedStatus) throw new Error(`${path} returned HTTP ${response.status}; expected ${expectedStatus}.`);
  if (!check(body)) throw new Error(`${path} returned an unexpected contract.`);
  console.log(`PASS ${path} HTTP ${response.status}`);
  return body;
}

async function smokeProduction() {
  console.log('\n=== Production smoke tests ===');
  const page = await fetch(`${PRODUCTION_URL}/`, { redirect: 'manual' });
  const html = await page.text();
  if (page.status !== 200 || !page.headers.get('content-type')?.includes('text/html') || !html.includes('/assets/')) {
    throw new Error('production UI or static asset references are unavailable.');
  }
  const asset = html.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
  if (!asset || !(await fetch(`${PRODUCTION_URL}${asset}`)).ok) throw new Error('production static asset smoke failed.');
  console.log(`PASS / and ${asset}`);

  await expectJson('/api/health', 200, (body) => body.status === 'ok');
  await expectJson('/api/auth/status', 200, (body) => typeof body.authenticated === 'boolean' && typeof body.bootstrapRequired === 'boolean');
  await expectJson('/api/auth/session', 401, (body) => Boolean(body.error));
  await expectJson('/api/v2/system/status', 401, (body) => Boolean(body.error));

  const adminToken = process.env.PRODUCTION_SMOKE_ADMIN_TOKEN || envFileValue('DEV_ADMIN_TOKEN');
  const gatewayToken = process.env.PRODUCTION_SMOKE_GATEWAY_TOKEN || envFileValue('GATEWAY_AUTH_TOKEN');
  if (!adminToken) throw new Error('PRODUCTION_SMOKE_ADMIN_TOKEN is required for authenticated v2 and D1-backed smoke tests.');
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };
  await expectJson('/api/v2/system/status', 200, (body) => body.ok === true, adminHeaders);
  await expectJson('/api/v2/providers?limit=1', 200, (body) => body.ok === true && Array.isArray(body.data?.items), adminHeaders);
  await expectJson('/api/v2/observability/metrics?hours=24', 200, (body) => body.ok === true, adminHeaders);

  if (configuredOrigin()) {
    if (!gatewayToken) throw new Error('PRODUCTION_SMOKE_GATEWAY_TOKEN is required for the origin-dependent gateway smoke test.');
    await expectJson('/v1/models', 200, (body) => Array.isArray(body.data), { Authorization: `Bearer ${gatewayToken}` });
  } else if (gatewayToken) {
    await expectJson('/v1/models', 503, (body) => body?.error?.code === 'origin_not_ready', { Authorization: `Bearer ${gatewayToken}` });
    console.log('Inference smoke correctly reports BLOCKED because OMNIROUTE_ORIGIN is not configured.');
  } else {
    console.log('Inference smoke BLOCKED/NOT-RUN: OMNIROUTE_ORIGIN is not configured and no gateway smoke token was supplied.');
  }
}

async function main() {
  const config = readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8');
  if (!/^name\s*=\s*"omniroute-edge"/m.test(config)) throw new Error(`wrangler.toml must target the existing ${WORKER_NAME} Worker.`);

  run('Deploy configuration', npm, ['run', 'verify:deploy-config']);
  await requireReachableOrigin();
  run('TypeScript', npm, ['run', 'lint']);
  run('Vitest', npm, ['test']);
  run('Node contract tests', npm, ['run', 'test:node']);
  run('Static safety', npm, ['run', 'verify:safety'], {
    timeout: 3 * 60_000,
    env: { ALLOW_LOCAL_DATA_BUNDLE: '1' },
  });
  verifyRemoteMigrations();
  run('Production build', npm, ['run', 'build']);
  run('Wrangler dry-run', npx, [...wrangler, 'deploy', '--dry-run']);
  const deployed = run('Deploy existing Worker', npx, [...wrangler, 'deploy']);
  const versionId = deployed.match(/(?:Current Version ID|Version ID):\s*([0-9a-f-]{36})/i)?.[1];
  if (!versionId) throw new Error('deployment completed without a parseable Worker Version ID.');
  await smokeProduction();
  console.log(`\nPRODUCTION DEPLOY PASS\nWorker: ${WORKER_NAME}\nURL: ${PRODUCTION_URL}\nVersion ID: ${versionId}`);
}

main().catch((error) => {
  console.error(`\nPRODUCTION DEPLOY FAIL: ${error.message}`);
  process.exit(1);
});
