import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ─── Providers ──────────────────────────────────────────────────────────────
export const providers = sqliteTable("providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("openai_compatible"), // openai, anthropic, google, mistral, deepseek, local, openai_compatible
  baseUrl: text("base_url").notNull(),
  apiKeyEncrypted: text("api_key_encrypted"), // AES-256-GCM ciphertext, never plaintext
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  priority: integer("priority").notNull().default(1), // 1-10, higher = preferred
  healthStatus: text("health_status").notNull().default("offline"), // healthy | degraded | offline
  latencyMs: integer("latency_ms"), // last measured latency
  successRate: real("success_rate").notNull().default(1), // rolling 0..1
  costPerToken: real("cost_per_token").notNull().default(0), // blended $ per token, informational default for scoring
  lastHealthCheck: integer("last_health_check"), // epoch ms
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

// ─── Models ─────────────────────────────────────────────────────────────────
export const models = sqliteTable("models", {
  id: text("id").primaryKey(), // uuid
  providerId: text("provider_id").notNull().references(() => providers.id, { onDelete: "cascade" }),
  modelName: text("model_name").notNull(), // provider-facing model id, e.g. "gpt-4o"
  capabilities: text("capabilities", { mode: "json" }).notNull().default("[]"), // ["reasoning","coding","vision",...]
  contextWindow: integer("context_window").notNull().default(8192),
  inputCost: real("input_cost").notNull().default(0), // $ per 1K input tokens
  outputCost: real("output_cost").notNull().default(0), // $ per 1K output tokens
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
});

// ─── API Keys (gateway + admin auth) ───────────────────────────────────────
export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  keyHash: text("key_hash").notNull(), // bcrypt hash — raw key is shown once at creation, never stored
  keyPrefix: text("key_prefix").notNull(), // first 12 chars, for display/lookup without exposing full key
  name: text("name").notNull(),
  role: text("role").notNull().default("gateway"), // admin | gateway
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
  lastUsedAt: integer("last_used_at"),
  createdAt: integer("created_at").notNull(),
});

// ─── Policies ───────────────────────────────────────────────────────────────
export const policies = sqliteTable("policies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // model_allowlist | model_denylist | provider_denylist | token_limit_daily | block_external_on_sensitive
  config: text("config", { mode: "json" }).notNull().default("{}"),
  action: text("action").notNull().default("deny"), // allow | deny
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
});

// ─── Requests (every gateway call, OpenAI-compatible surface) ─────────────
export const requests = sqliteTable("requests", {
  id: text("id").primaryKey(),
  timestamp: integer("timestamp").notNull(),
  clientId: text("client_id").notNull(), // api key id that made the call
  requestType: text("request_type").notNull().default("chat"), // chat | coding | vision | embeddings | reasoning
  requestedModel: text("requested_model"),
  selectedModel: text("selected_model"),
  providerId: text("provider_id"),
  latencyMs: integer("latency_ms").notNull().default(0),
  tokensInput: integer("tokens_input").notNull().default(0),
  tokensOutput: integer("tokens_output").notNull().default(0),
  cost: real("cost").notNull().default(0),
  routingReason: text("routing_reason"),
  status: text("status").notNull().default("success"), // success | error | blocked
});

// ─── Routing Decisions (explainable scoring trail, 1:1 with requests) ─────
export const routingDecisions = sqliteTable("routing_decisions", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
  timestamp: integer("timestamp").notNull(),
  requestType: text("request_type").notNull(),
  selectedProviderId: text("selected_provider_id"),
  selectedModelId: text("selected_model_id"),
  score: real("score"), // final weighted score 0..100
  reasons: text("reasons", { mode: "json" }).notNull().default("[]"), // ["coding optimized","lower cost","provider healthy"]
  candidates: text("candidates", { mode: "json" }).notNull().default("[]"), // full scored candidate list for audit
});

// ─── Security Events (AI Firewall decisions) ───────────────────────────────
export const securityEvents = sqliteTable("security_events", {
  id: text("id").primaryKey(),
  timestamp: integer("timestamp").notNull(),
  eventType: text("event_type").notNull(), // prompt_injection | secret_leakage | suspicious_instruction | rate_limit_exceeded | policy_violation
  severity: text("severity").notNull().default("medium"), // low | medium | high | critical
  source: text("source"), // client_id / api key name
  action: text("action").notNull(), // ALLOW | WARN | BLOCK
  detail: text("detail"),
  requestId: text("request_id"),
});

// ─── Audit Log (admin actions — separate from AI Firewall security_events) ─
export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  timestamp: integer("timestamp").notNull(),
  actorKeyId: text("actor_key_id"), // api_keys.id of the admin who performed the action
  actorName: text("actor_name").notNull().default("unknown"),
  action: text("action").notNull(), // create | update | delete | revoke
  resourceType: text("resource_type").notNull(), // provider | model | api_key | policy
  resourceId: text("resource_id"),
  detail: text("detail"), // human-readable summary — never contains secrets/plaintext keys
});

// ─── Request Attempts (failover evidence — one row per upstream attempt) ───
export const requestAttempts = sqliteTable("request_attempts", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(), // 1-based
  providerId: text("provider_id").notNull(),
  modelName: text("model_name").notNull(),
  startedAt: integer("started_at").notNull(), // epoch ms
  latencyMs: integer("latency_ms").notNull().default(0),
  result: text("result").notNull(), // success | retryable_error | non_retryable_error
  failureCategory: text("failure_category"), // timeout | upstream_5xx | rate_limited | network | policy_denied | null
  httpStatus: integer("http_status"), // upstream HTTP status if available
  errorDetail: text("error_detail"), // short description, no upstream body
});
