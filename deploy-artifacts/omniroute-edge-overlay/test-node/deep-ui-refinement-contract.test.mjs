import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const markers = {
  'src/components/DashboardView.tsx': [
    'Dashboard detail', 'Data source', 'View request logs', 'Runtime Resources',
  ],
  'src/components/WorkspacePrimitives.tsx': [
    'InspectorDrawer', 'ModalDialog', 'WorkspaceTabs', 'SourcePill', 'ProgressBar',
  ],
  'src/components/Header.tsx': [
    'Command palette', 'System health', 'Notifications', 'Environment', 'Account',
  ],
  'src/components/Sidebar.tsx': [
    'PRIMARY', 'OBSERVABILITY', 'Gateway Status', 'Inventory',
  ],
  'src/components/ProvidersView.tsx': [
    'Provider inspector', 'Traffic share', 'Credentials', 'Configuration', 'History',
  ],
  'src/components/ModelsView.tsx': [
    'Model inspector', 'Compare models', 'Context window', 'Capabilities', 'Pricing',
  ],
  'src/components/LogsView.tsx': [
    'Request detail', 'Date range', 'Page size', 'Export visible', 'Auto refresh',
  ],
  'src/components/TracesView.tsx': [
    'Status filter', 'Provider filter', 'Trace timeline', 'Streaming',
  ],
  'src/components/AlertsView.tsx': [
    'Active', 'History', 'Rules', 'Source filter', 'Alert detail',
  ],
  'src/components/AuditLogView.tsx': [
    'Audit detail', 'Action filter', 'Resource filter', 'Before', 'After',
  ],
  'src/components/SettingsView.tsx': [
    'General', 'Data', 'OmniRoute', 'Cloudflare', 'Advanced', 'Runtime warning',
  ],
  'src/components/TopologyView.tsx': [
    'Topology inspector', 'Provider state', 'Filter result', 'Observed traffic',
  ],
};

test('deep UI refinement exposes shared overlays, grouped navigation, and detailed workspaces', async () => {
  for (const [path, expected] of Object.entries(markers)) {
    const source = await readFile(path, 'utf8');
    for (const marker of expected) assert.ok(source.includes(marker), `${path} must contain ${marker}`);
  }
});

test('deep UI refinement keeps no-fabrication invariants', async () => {
  const sources = await Promise.all(Object.keys(markers).map((path) => readFile(path, 'utf8').catch(() => '')));
  const combined = sources.join('\n');
  for (const forbidden of ['1.24M', '99.98%', '2,847', '682 ms', 'Active Shield', 'Dynamic (40/25/20/10/5)']) {
    assert.equal(combined.includes(forbidden), false, `must not hard-code ${forbidden}`);
  }
});
