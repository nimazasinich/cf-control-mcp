export interface ProviderMetadata {
  costPer1k?: number;
  baseLatency?: number;
  successRate?: number;
  trafficShare?: number;
  lastPing?: number;
  supportedModels?: string[];
  region?: string;
  [key: string]: unknown;
}

export interface Provider {
  id: string;
  name: string;
  type?: string;
  baseUrl: string;
  enabled: boolean;
  priority: number;
  status: 'Healthy' | 'Degraded' | 'Offline' | 'Disabled' | string;
  healthStatus?: 'healthy' | 'degraded' | 'offline' | string;
  latencyMs?: number;
  successRate?: number;
  costPerToken?: number;
  hasApiKey?: boolean;
  metadata?: ProviderMetadata | string;
  createdAt?: number;
  updatedAt?: number;
}

export interface Model {
  id: string;
  name: string;
  modelName?: string;
  providerId: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities?: string[] | string;
  costPer1kPrompt?: number;
  costPer1kCompletion?: number;
  inputCost?: number;
  outputCost?: number;
  active?: boolean;
  enabled?: boolean;
}

export interface RoutingDecision {
  id?: string;
  timestamp: number;
  requestType: string;
  selectedModel: string;
  providerId?: string;
  routingReason: string;
  latency: number;
  clientIp?: string;
  tokensUsed?: number;
  cost?: number;
  cacheHit?: boolean;
}

export interface SecurityEvent {
  id?: string;
  timestamp: number;
  eventType: string;
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  sourceIp?: string;
  action: 'Blocked' | 'Challenged' | 'Logged' | 'Allowed';
  ruleTriggered?: string;
  details?: string;
}

export interface DashboardStats {
  totalRequests: number;
  activeProviders: number;
  healthyProviders?: number;
  degradedProviders: number;
  offlineProviders: number;
  avgLatency: number;
  blockedThreats: number;
  cacheHitRate?: number;
  estimatedCostSavings?: number;
}

export interface AnalyticsSeriesPoint {
  timestamp: number;
  count: number;
  avgLatencyMs?: number;
}

export interface AnalyticsProviderBucket {
  providerId: string | null;
  providerName: string;
  count: number;
  cost: number;
  avgLatencyMs: number;
}

export interface AnalyticsData {
  memoryUsage: number;
  memoryAllocated: number;
  cpuUsage: number;
  cpuTrend: number;
  requestsPerSec: number;
  requestsTrend: number;
  avgExecution: number;
  executionTrend: number;
  windowHours?: number;
  totalRequests?: number;
  avgLatencyMs?: number;
  totalTokens?: number;
  tokensIn?: number;
  tokensOut?: number;
  estimatedCost?: number;
  byStatus?: Array<{ status: string; count: number }>;
  byRequestType?: Array<{ requestType: string; count: number }>;
  byProvider?: AnalyticsProviderBucket[];
  securityBySeverity?: Array<{ severity: string; count: number }>;
  requestVolumeSeries?: AnalyticsSeriesPoint[];
}

export interface RuntimeStatus {
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  uptimeSeconds: number;
}

export interface SystemReadiness {
  ready: boolean;
  checkedAt: number;
  adminKeys: number;
  gatewayKeys: number;
  providerCount: number;
  enabledProviders: number;
  healthyProviders: number;
  degradedProviders: number;
  offlineProviders: number;
  modelCount: number;
  enabledModelCount: number;
  policyCount: number;
  requestCount24h: number;
  errorCount24h: number;
  blockedCount24h: number;
  lastRequestAt: number | null;
  lastSecurityEventAt: number | null;
  issues: string[];
}

export interface OperationalAlert {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: string;
  title: string;
  detail: string;
  timestamp: number;
  actionPath?: string;
  actionLabel?: string;
  source?: string;
}

export interface TopologySource {
  id: string;
  name: string;
  volume: number;
  type: string;
  status?: string;
}

export interface TopologyApplicationNode {
  id: string;
  label: string;
  sourceStatus: 'classified' | 'unknown';
  requestsLast24h: number;
  trafficSharePct: number;
  avgLatencyMs: number;
  type: string;
}

export interface TopologyProviderNode {
  id: string;
  label: string;
  type: string;
  health: 'healthy' | 'degraded' | 'offline' | 'disabled' | 'unknown';
  requestsLast24h: number;
  trafficSharePct: number;
  avgLatencyMs: number;
  latencySource: 'traffic' | 'health' | 'none';
  connectionState: 'observed' | 'configured';
  modelCount: number;
  enabledModelCount: number | null;
}

export interface TopologyData {
  nodes: {
    applications: TopologyApplicationNode[];
    edge: { label: string; totalRequestsLast24h: number };
    router: { label: string; totalRequestsLast24h: number };
    providers: TopologyProviderNode[];
  };
}

export interface ApiKeyItem {
  id: string;
  name: string;
  role: string;
  revoked: boolean;
  maskedKey: string;
  rawSecret?: string;
  createdAt?: number;
}

export interface SecurityPolicy {
  id: string;
  name?: string;
  type: string;
  value: string;
  config?: unknown;
  action: 'allow' | 'deny' | string;
  enabled?: boolean;
}

export interface RouterSettings {
  healthWeight: number;
  latencyWeight: number;
  costWeight: number;
  capabilityWeight: number;
  priorityWeight: number;
  failoverThresholdMs: number;
  pingIntervalSeconds: number;
  zeroTrustMode: string;
  firewallStrictness: string;
  logRetentionDays: number;
}

export interface DashboardData {
  stats: DashboardStats | null;
  analytics: AnalyticsData | null;
  topology: TopologyData | null;
  history: RoutingDecision[];
  securityEvents: SecurityEvent[];
  providers: Provider[];
  models: Model[];
  apiKeys?: ApiKeyItem[];
  policies?: SecurityPolicy[];
  settings?: RouterSettings | null;
  runtime?: RuntimeStatus | null;
  readiness?: SystemReadiness | null;
  alerts?: OperationalAlert[];
  loading: boolean;
  refetch: () => Promise<void>;
}

