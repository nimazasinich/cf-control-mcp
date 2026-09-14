import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const configPath = resolve(process.argv[2] ?? 'wrangler.toml');
const source = readFileSync(configPath, 'utf8');
const errors = [];
const notes = [];
const ZERO_D1_ID = '00000000-0000-0000-0000-000000000000';

const databaseId = source.match(/^\s*database_id\s*=\s*"([^"]*)"/m)?.[1]?.trim() ?? '';
if (!databaseId || databaseId === ZERO_D1_ID) {
  errors.push('D1 database_id is still the fail-closed placeholder. Create/inspect the dedicated database and set its verified ID before deploy.');
}

const configuredOrigin = process.env.OMNIROUTE_ORIGIN?.trim()
  || source.match(/^\s*OMNIROUTE_ORIGIN\s*=\s*"([^"]*)"/m)?.[1]?.trim()
  || '';

if (!configuredOrigin) {
  notes.push('OmniRoute origin: not configured; inference remains BLOCKED until a verified HTTPS origin is configured.');
} else {
  try {
    const url = new URL(configuredOrigin);
    if (url.protocol !== 'https:') errors.push('OMNIROUTE_ORIGIN must use https: for deployment.');
    if (url.username || url.password) errors.push('OMNIROUTE_ORIGIN must not embed credentials in the URL.');
    notes.push(`OmniRoute origin host: ${url.host}`);
  } catch {
    errors.push('OMNIROUTE_ORIGIN is not a valid URL.');
  }
}

const environment = source.match(/^\s*ENVIRONMENT\s*=\s*"([^"]*)"/m)?.[1]?.trim() ?? '';
if (environment !== 'production') errors.push(`ENVIRONMENT must be "production" for this deployment config; found ${environment || 'empty'}.`);

if (!source.includes('ROUTING_AUTHORITY = "omniroute"')) {
  errors.push('ROUTING_AUTHORITY must remain "omniroute".');
}

if (errors.length) {
  console.error(`DEPLOY CONFIG FAIL (${errors.length} errors)`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('DEPLOY CONFIG PASS');
console.log(`- D1 database ID configured: ${databaseId}`);
for (const note of notes) console.log(`- ${note}`);
console.log('- Routing authority: omniroute');
