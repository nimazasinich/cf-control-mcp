import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { DashboardStats, AnalyticsData, TopologyData, RoutingDecision, SecurityEvent, Provider, Model, DashboardData, RuntimeStatus, SystemReadiness, OperationalAlert } from './types';

import { AppShell } from './components/AppShell';
import { DashboardView } from './components/DashboardView';
import { TopologyView } from './components/TopologyView';
import { ProvidersSection } from './components/ProvidersView';
import { Models } from './components/ModelsView';
import { RoutingRulesView } from './components/RoutingRulesView';
import { ApiKeysView } from './components/ApiKeysView';
import { SecurityPoliciesView } from './components/SecurityPoliciesView';
import { FirewallView } from './components/FirewallView';
import { LogsView } from './components/LogsView';
import { AnalyticsView } from './components/AnalyticsView';
import { AlertsView } from './components/AlertsView';
import { SettingsView } from './components/SettingsView';
import { TracesView } from './components/TracesView';
import { AuditLogView } from './components/AuditLogView';
import { EditProviderModal } from './components/EditProviderModal';

type ApiRecord = Record<string, unknown>;

function asRecord(value: unknown): ApiRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ApiRecord : {};
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asOptionalNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function titleHealth(value: unknown, enabled: unknown = true): Provider['status'] {
  if (enabled === false || enabled === 0) return 'Disabled';
  const text = String(value ?? '').toLowerCase();
  if (text === 'healthy') return 'Healthy';
  if (text === 'degraded') return 'Degraded';
  if (text === 'offline') return 'Offline';
  if (text === 'disabled') return 'Disabled';
  return text || 'Unknown';
}

function normalizeProvider(row: unknown): Provider {
  const p = asRecord(row);
  const healthStatus = p.healthStatus ?? p.status;
  const latencyMs = asNumber(p.latencyMs ?? asRecord(p.metadata).baseLatency, 0);
  const successRate = asNumber(p.successRate, 0);
  const costPerToken = asNumber(p.costPerToken, 0);
  return {
    id: String(p.id ?? ''),
    name: String(p.name ?? 'Unknown Provider'),
    baseUrl: String(p.baseUrl ?? p.base_url ?? ''),
    enabled: p.enabled !== false && p.enabled !== 0,
    priority: asNumber(p.priority, 1),
    status: titleHealth(healthStatus, p.enabled),
    metadata: {
      ...asRecord(p.metadata),
      baseLatency: latencyMs,
      successRate: successRate > 0 && successRate <= 1 ? successRate * 100 : successRate,
      costPer1k: costPerToken > 0 ? costPerToken * 1000 : asNumber(asRecord(p.metadata).costPer1k, 0),
    },
    createdAt: asNumber(p.createdAt ?? p.created_at, 0) || undefined,
  };
}

function normalizeModel(row: unknown): Model {
  const m = asRecord(row);
  return {
    id: String(m.id ?? m.modelName ?? m.name ?? ''),
    name: String(m.name ?? m.modelName ?? 'Unknown Model'),
    providerId: String(m.providerId ?? m.provider_id ?? ''),
    contextWindow: asNumber(m.contextWindow, 0) || undefined,
    capabilities: m.capabilities as Model['capabilities'],
    costPer1kPrompt: asNumber(m.inputCost, 0) || undefined,
    costPer1kCompletion: asNumber(m.outputCost, 0) || undefined,
    active: m.enabled !== false && m.enabled !== 0,
  };
}

function normalizeStats(row: unknown): DashboardStats {
  const s = asRecord(row);
  return {
    totalRequests: asNumber(s.totalRequests ?? s.totalRequestsLast24h, 0),
    activeProviders: asNumber(s.activeProviders, 0),
    healthyProviders: asNumber(s.healthyProviders, 0),
    degradedProviders: asNumber(s.degradedProviders, 0),
    offlineProviders: asNumber(s.offlineProviders, 0),
    avgLatency: asNumber(s.avgLatency ?? s.avgLatencyMs, 0),
    blockedThreats: asNumber(s.blockedThreats ?? s.blockedThreatsLast24h, 0),
    estimatedCostSavings: asNumber(s.estimatedCostLast24h, 0),
  };
}

function normalizeAnalytics(row: unknown): AnalyticsData {
  const a = asRecord(row);
  const requestVolumeSeries = Array.isArray(a.requestVolumeSeries)
    ? a.requestVolumeSeries.map((point) => {
      const item = asRecord(point);
      return {
        timestamp: asNumber(item.timestamp, 0),
        count: asNumber(item.count, 0),
        avgLatencyMs: asNumber(item.avgLatencyMs, 0),
      };
    })
    : [];
  return {
    memoryUsage: asNumber(a.memoryUsage, 0),
    memoryAllocated: asNumber(a.memoryAllocated, 0),
    cpuUsage: asNumber(a.cpuUsage, 0),
    cpuTrend: asNumber(a.cpuTrend, 0),
    requestsPerSec: asNumber(a.requestsPerSec ?? a.totalRequests, 0),
    requestsTrend: asNumber(a.requestsTrend, 0),
    avgExecution: asNumber(a.avgExecution ?? a.avgLatencyMs, 0),
    executionTrend: asNumber(a.executionTrend, 0),
    windowHours: asNumber(a.windowHours, 24),
    totalRequests: asNumber(a.totalRequests, 0),
    avgLatencyMs: asNumber(a.avgLatencyMs, 0),
    totalTokens: asNumber(a.totalTokens, 0),
    tokensIn: asNumber(a.tokensIn, 0),
    tokensOut: asNumber(a.tokensOut, 0),
    estimatedCost: asNumber(a.estimatedCost, 0),
    byStatus: Array.isArray(a.byStatus) ? a.byStatus.map((item) => ({ status: String(asRecord(item).status ?? 'unknown'), count: asNumber(asRecord(item).count, 0) })) : [],
    byRequestType: Array.isArray(a.byRequestType) ? a.byRequestType.map((item) => ({ requestType: String(asRecord(item).requestType ?? 'unknown'), count: asNumber(asRecord(item).count, 0) })) : [],
    byProvider: Array.isArray(a.byProvider) ? a.byProvider.map((item) => {
      const provider = asRecord(item);
      return {
        providerId: provider.providerId === null || provider.providerId === undefined ? null : String(provider.providerId),
        providerName: String(provider.providerName ?? 'Unknown'),
        count: asNumber(provider.count, 0),
        cost: asNumber(provider.cost, 0),
        avgLatencyMs: asNumber(provider.avgLatencyMs, 0),
      };
    }) : [],
    securityBySeverity: Array.isArray(a.securityBySeverity) ? a.securityBySeverity.map((item) => ({ severity: String(asRecord(item).severity ?? 'unknown'), count: asNumber(asRecord(item).count, 0) })) : [],
    requestVolumeSeries,
  };
}

function normalizeRuntime(row: unknown): RuntimeStatus | null {
  const r = asRecord(row);
  if (!Object.keys(r).length) return null;
  return {
    heapUsedMb: asNumber(r.heapUsedMb, 0),
    heapTotalMb: asNumber(r.heapTotalMb, 0),
    rssMb: asNumber(r.rssMb, 0),
    cpuUserMs: asNumber(r.cpuUserMs, 0),
    cpuSystemMs: asNumber(r.cpuSystemMs, 0),
    uptimeSeconds: asNumber(r.uptimeSeconds, 0),
  };
}

function normalizeReadiness(row: unknown): SystemReadiness | null {
  const r = asRecord(row);
  if (!Object.keys(r).length) return null;
  return {
    ready: Boolean(r.ready),
    checkedAt: asNumber(r.checkedAt, Date.now()),
    adminKeys: asNumber(r.adminKeys, 0),
    gatewayKeys: asNumber(r.gatewayKeys, 0),
    providerCount: asNumber(r.providerCount, 0),
    enabledProviders: asNumber(r.enabledProviders, 0),
    healthyProviders: asNumber(r.healthyProviders, 0),
    degradedProviders: asNumber(r.degradedProviders, 0),
    offlineProviders: asNumber(r.offlineProviders, 0),
    modelCount: asNumber(r.modelCount, 0),
    enabledModelCount: asNumber(r.enabledModelCount, 0),
    policyCount: asNumber(r.policyCount, 0),
    requestCount24h: asNumber(r.requestCount24h, 0),
    errorCount24h: asNumber(r.errorCount24h, 0),
    blockedCount24h: asNumber(r.blockedCount24h, 0),
    lastRequestAt: asOptionalNumber(r.lastRequestAt),
    lastSecurityEventAt: asOptionalNumber(r.lastSecurityEventAt),
    issues: asStringArray(r.issues),
  };
}

function normalizeAlerts(rows: unknown): OperationalAlert[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((item) => {
    const alert = asRecord(item);
    const severity = String(alert.severity ?? 'medium').toLowerCase();
    const normalizedSeverity = severity === 'critical' || severity === 'high' || severity === 'low' ? severity : 'medium';
    return {
      id: String(alert.id ?? crypto.randomUUID?.() ?? `${Date.now()}`),
      severity: normalizedSeverity,
      type: String(alert.type ?? 'operational_alert'),
      title: String(alert.title ?? 'Operational alert'),
      detail: String(alert.detail ?? alert.description ?? ''),
      timestamp: asNumber(alert.timestamp, Date.now()),
      actionPath: alert.actionPath ? String(alert.actionPath) : undefined,
      actionLabel: alert.actionLabel ? String(alert.actionLabel) : undefined,
      source: alert.source ? String(alert.source) : undefined,
    };
  });
}

function normalizeHistory(rows: unknown): RoutingDecision[] {
  return Array.isArray(rows) ? rows.map((item) => {
    const r = asRecord(item);
    const reasons = Array.isArray(r.reasons) ? r.reasons.join(', ') : String(r.reasons ?? r.routingReason ?? 'No routing reason recorded');
    return {
      id: String(r.id ?? ''),
      timestamp: asNumber(r.timestamp, Date.now()),
      requestType: String(r.requestType ?? 'chat'),
      selectedModel: String(r.selectedModel ?? r.modelName ?? r.selectedModelId ?? 'Unknown'),
      providerId: r.providerId ? String(r.providerId) : r.selectedProviderId ? String(r.selectedProviderId) : undefined,
      routingReason: reasons,
      latency: asNumber(r.latency ?? r.latencyMs, 0),
      cost: asNumber(r.cost, 0),
    };
  }) : [];
}

function normalizeEvents(rows: unknown): SecurityEvent[] {
  return Array.isArray(rows) ? rows.map((item) => {
    const e = asRecord(item);
    const severity = String(e.severity ?? 'medium').toLowerCase();
    const titledSeverity = severity === 'critical' ? 'Critical' : severity === 'high' ? 'High' : severity === 'low' ? 'Low' : 'Medium';
    const action = String(e.action ?? 'Logged').toUpperCase();
    return {
      id: String(e.id ?? ''),
      timestamp: asNumber(e.timestamp, Date.now()),
      eventType: String(e.eventType ?? e.event_type ?? 'security_event'),
      severity: titledSeverity,
      sourceIp: e.sourceIp ? String(e.sourceIp) : e.source ? String(e.source) : undefined,
      action: action === 'BLOCK' || action === 'BLOCKED' ? 'Blocked' : action === 'ALLOW' || action === 'ALLOWED' ? 'Allowed' : 'Logged',
      details: e.detail ? String(e.detail) : undefined,
    };
  }) : [];
}

function useDashboardData(): DashboardData {
  const [data, setData] = useState<{
    stats: DashboardStats | null;
    analytics: AnalyticsData | null;
    topology: TopologyData | null;
    history: RoutingDecision[];
    securityEvents: SecurityEvent[];
    providers: Provider[];
    models: Model[];
    runtime: RuntimeStatus | null;
    readiness: SystemReadiness | null;
    alerts: OperationalAlert[];
    loading: boolean;
  }>({
    stats: null,
    analytics: null,
    topology: null,
    history: [],
    securityEvents: [],
    providers: [],
    models: [],
    runtime: null,
    readiness: null,
    alerts: [],
    loading: true
  });

  const fetchData = async () => {
    try {
      const [statsRes, analyticsRes, topologyRes, historyRes, eventsRes, provRes, modelsRes, runtimeRes, readinessRes, alertsRes] = await Promise.all([
        fetch('/api/dashboard/stats'),
        fetch('/api/analytics'),
        fetch('/api/topology'),
        fetch('/api/routing/history'),
        fetch('/api/security/events'),
        fetch('/api/providers'),
        fetch('/api/models'),
        fetch('/api/runtime'),
        fetch('/api/readiness'),
        fetch('/api/alerts')
      ]);

      const [stats, analytics, topology, history, securityEvents, providers, models, runtime, readiness, alerts] = await Promise.all([
        statsRes.json().catch(() => null),
        analyticsRes.json().catch(() => null),
        topologyRes.json().catch(() => null),
        historyRes.json().catch(() => []),
        eventsRes.json().catch(() => []),
        provRes.json().catch(() => []),
        modelsRes.json().catch(() => []),
        runtimeRes.json().catch(() => null),
        readinessRes.json().catch(() => null),
        alertsRes.json().catch(() => [])
      ]);

      setData({
        stats: normalizeStats(stats),
        analytics: normalizeAnalytics(analytics),
        topology,
        history: normalizeHistory(history),
        securityEvents: normalizeEvents(securityEvents),
        providers: Array.isArray(providers) ? providers.map(normalizeProvider) : [],
        models: Array.isArray(models) ? models.map(normalizeModel) : [],
        runtime: normalizeRuntime(runtime),
        readiness: normalizeReadiness(readiness),
        alerts: normalizeAlerts(alerts),
        loading: false
      });
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
      setData(prev => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, []);

  return { ...data, refetch: fetchData };
}

export default function App() {
  const data = useDashboardData();
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const openEditModal = (provider: Provider) => {
    setEditingProvider(provider);
    setIsEditModalOpen(true);
  };

  return (
    <Router>
      <AppShell
        onRefresh={data.refetch}
        isRefreshing={data.loading}
        readiness={data.readiness}
        alerts={data.alerts}
        observedRequests={data.stats?.totalRequests ?? 0}
      >
        <Routes>
          <Route path="/" element={<DashboardView data={data} onOpenEditModal={openEditModal} />} />
          <Route path="/topology" element={<TopologyView data={data} onOpenEditModal={openEditModal} />} />
          <Route 
            path="/providers" 
            element={
              <ProvidersSection 
                providers={data.providers} 
                onRefresh={data.refetch} 
                onEditProvider={openEditModal} 
              />
            } 
          />
          <Route 
            path="/models" 
            element={
              <Models 
                providers={data.providers} 
                models={data.models} 
                onConfigureProvider={openEditModal} 
              />
            } 
          />
          <Route path="/routing" element={<RoutingRulesView data={data} />} />
          <Route path="/keys" element={<ApiKeysView />} />
          <Route path="/policies" element={<SecurityPoliciesView />} />
          <Route path="/firewall" element={<FirewallView data={data} />} />
          <Route path="/logs" element={<LogsView />} />
          <Route path="/analytics" element={<AnalyticsView data={data} />} />
          <Route path="/alerts" element={<AlertsView data={data} />} />
          <Route path="/metrics" element={<AnalyticsView data={data} />} />
          <Route path="/traces" element={<TracesView />} />
          <Route path="/audit" element={<AuditLogView />} />
          <Route path="/settings" element={<SettingsView data={data} />} />
          
          {/* Catch-all redirect to Dashboard */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        {/* Global Provider Edit Modal accessible from any page */}
        <EditProviderModal
          provider={editingProvider}
          isOpen={isEditModalOpen}
          onClose={() => {
            setIsEditModalOpen(false);
            setEditingProvider(null);
          }}
          onSaved={data.refetch}
        />
      </AppShell>
    </Router>
  );
}
