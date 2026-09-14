import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');

test('dashboard shell matches the supplied Cloudflare AI Router reference structure', async () => {
  const [header, sidebar, dashboard, css] = await Promise.all([
    read('src/components/Header.tsx'),
    read('src/components/Sidebar.tsx'),
    read('src/components/DashboardView.tsx'),
    read('src/index.css'),
  ]);

  assert.ok(header.includes('Cloudflare AI Router'));
  assert.ok(header.includes('Secure AI traffic orchestration across the edge'));
  assert.equal(header.includes('DreamWorker dashboard home'), false);

  for (const label of ['Dashboard', 'AI Topology', 'Providers', 'Models', 'Routing Status', 'API Keys', 'Security Policies', 'Security Events', 'Logs', 'Metrics', 'Traces', 'Analytics', 'Alerts', 'Settings', 'Gateway Status']) {
    assert.ok(sidebar.includes(label), `sidebar must contain ${label}`);
  }

  for (const marker of ['cf-dashboard-content', 'cf-dashboard-left-col', 'cf-dashboard-right-col', 'Blocked Requests', 'Security Event Activity', 'Recent Edge Requests']) {
    assert.ok(dashboard.includes(marker), `dashboard must contain ${marker}`);
  }

  for (const forbidden of ['Blocked Threats', 'AI Firewall Activity', 'Recent AI Routing Decisions']) {
    assert.equal(dashboard.includes(forbidden), false, `dashboard must not present screenshot-only claim ${forbidden}`);
  }

  for (const marker of [
    '--sidebar-w: 144px', '--header-h: 62px',
    'padding:14px 15px', 'height:84px',
    'grid-template-columns:786px 397px', 'height:334px',
    'height:197px', 'height:138px', 'height:201px', 'height:193px',
  ]) {
    assert.ok(css.includes(marker), `reference CSS marker missing: ${marker}`);
  }
});

test('reference dashboard remains data-driven and does not hard-code screenshot metrics', async () => {
  const files = await Promise.all([
    read('src/components/DashboardView.tsx'),
    read('src/components/TopologyMap.tsx'),
    read('src/components/RuntimeResourcesCard.tsx'),
    read('src/components/ProviderHealthCard.tsx'),
    read('src/components/GlobalEdgeTrafficCard.tsx'),
  ]);
  const combined = files.join('\n');
  for (const fakeLiteral of ['1.24M', '2,847', '99.98%', '6.8 GB', '682 ms', 'OpenAI GPT-4o', 'Claude 3.5']) {
    assert.equal(combined.includes(fakeLiteral), false, `must not hard-code reference metric/data ${fakeLiteral}`);
  }
});
