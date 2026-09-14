import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const required = [
  ['src/App.tsx', ['DashboardView', 'AppShell']],
  ['src/components/Header.tsx', ['Cloudflare AI Router', 'Overview', 'Topology', 'Security', 'Analytics', 'Settings']],
  ['src/components/Sidebar.tsx', ['Dashboard', 'AI Topology', 'Providers', 'Models', 'Routing Status', 'API Keys', 'Security Policies', 'Security Events', 'Logs', 'Metrics', 'Traces', 'Analytics', 'Alerts', 'Settings']],
  ['src/components/DashboardView.tsx', ['Global AI Traffic Topology', 'Runtime Resources', 'Security Event Activity', 'Recent Edge Requests', 'Provider Health', 'Global Edge Traffic']],
  ['src/index.css', ['1368', '753']],
];

test('canonical V3 contains the approved dashboard UI structure', async () => {
  for (const [path, markers] of required) {
    const source = await readFile(path, 'utf8');
    for (const marker of markers) {
      assert.ok(source.includes(marker), `${path} must contain ${marker}`);
    }
  }
});

test('dashboard source does not hard-code screenshot operational metrics', async () => {
  const dashboard = await readFile('src/components/DashboardView.tsx', 'utf8');
  for (const fakeLiteral of ['1.24M', '2,847', '99.98%', '6.8 GB', '682 ms']) {
    assert.equal(dashboard.includes(fakeLiteral), false, `must not hard-code ${fakeLiteral}`);
  }
});
