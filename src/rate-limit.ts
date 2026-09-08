export interface RateLimitDecision {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
}

/**
 * D1-backed fixed-window limiter. The UPSERT is a single atomic statement;
 * the follow-up SELECT can only make enforcement more conservative under
 * concurrency (it may observe a later count), never permit an extra request.
 */
export async function consumeRateLimit(
  db: D1Database,
  input: { principal: string; bucket: string; limit: number; windowSeconds: number; nowSeconds?: number },
): Promise<RateLimitDecision> {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / input.windowSeconds) * input.windowSeconds;
  await db.prepare(
    `INSERT INTO rate_limit_buckets (principal, bucket, window_start, request_count, updated_at)
     VALUES (?, ?, ?, 1, datetime('now'))
     ON CONFLICT(principal, bucket) DO UPDATE SET
       request_count = CASE WHEN rate_limit_buckets.window_start = excluded.window_start
                            THEN rate_limit_buckets.request_count + 1 ELSE 1 END,
       window_start = excluded.window_start,
       updated_at = datetime('now')`,
  ).bind(input.principal, input.bucket, windowStart).run();

  const row = await db.prepare(
    "SELECT window_start, request_count FROM rate_limit_buckets WHERE principal = ? AND bucket = ?",
  ).bind(input.principal, input.bucket).first<{ window_start: number; request_count: number }>();
  const count = Number(row?.request_count ?? 1);
  const retryAfterSeconds = Math.max(1, windowStart + input.windowSeconds - now);
  return { allowed: count <= input.limit, count, limit: input.limit, retryAfterSeconds };
}
