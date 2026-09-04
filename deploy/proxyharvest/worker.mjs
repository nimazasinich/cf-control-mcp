const VERSION = '3.0.0';
const SERVICE = 'ProxyHarvest Fetch Gateway';
const MAX_BODY_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 12_000;
const PROBE_TIMEOUT_MS = 8_000;
const CACHE_TTL_SECONDS = 300;

const ALLOWED_SOURCE_HOSTS = new Set([
  'raw.githubusercontent.com',
  'raw.githubusercontents.com',
  'cdn.jsdelivr.net',
  'fastly.jsdelivr.net',
  'gcore.jsdelivr.net',
  'ghproxy.com',
  'mirror.ghproxy.com',
  'github.moeyy.xyz',
]);

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  '169.254.169.254',
  '100.100.100.200',
]);

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
];

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept,Cache-Control',
    'Access-Control-Max-Age': '86400',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  };
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    }),
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: corsHeaders({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    }),
  });
}

function raw(body, status = 200, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: corsHeaders({
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      ...extraHeaders,
    }),
  });
}

function isPrivateOrBlockedHost(hostname) {
  const h = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || BLOCKED_HOSTS.has(h) || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (PRIVATE_V4.some((re) => re.test(h))) return true;
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  return false;
}

function ensureAllowedSourceUrl(input) {
  let target;
  try {
    target = new URL(String(input || ''));
  } catch {
    throw new Error('invalid-url');
  }
  if (target.protocol !== 'https:') throw new Error('https-required');
  if (target.username || target.password) throw new Error('credentials-not-allowed');
  if (isPrivateOrBlockedHost(target.hostname)) throw new Error('blocked-host');
  if (!ALLOWED_SOURCE_HOSTS.has(target.hostname.toLowerCase())) throw new Error('source-host-not-allowed');
  return target;
}

function ensureProbeTarget(host, port) {
  const hostname = String(host || '').trim().replace(/^\[|\]$/g, '');
  const nport = Number(port || 443);
  if (!hostname || isPrivateOrBlockedHost(hostname)) throw new Error('blocked-host');
  if (!Number.isInteger(nport) || nport < 1 || nport > 65535) throw new Error('invalid-port');
  return { hostname, port: nport };
}

function abortAfter(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), ms);
  return { controller, cancel: () => clearTimeout(timer) };
}

async function fetchWithLimit(target, options = {}) {
  const started = Date.now();
  const { controller, cancel } = abortAfter(options.timeoutMs || FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(target.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': 'ProxyHarvest/10 (+Cloudflare Worker)',
        Accept: 'text/plain,text/yaml,application/json,*/*;q=0.8',
      },
      cf: { cacheTtl: 0, cacheEverything: false },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`redirect-${response.status}-without-location`);
      const redirected = ensureAllowedSourceUrl(new URL(location, target).toString());
      return await fetchWithLimit(redirected, options);
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_BODY_BYTES) throw new Error('response-too-large');

    const body = await response.text();
    const bytes = new TextEncoder().encode(body).byteLength;
    if (bytes > MAX_BODY_BYTES) throw new Error('response-too-large');

    return {
      ok: response.ok,
      status: response.status,
      body,
      bytes,
      latencyMs: Date.now() - started,
      contentType: response.headers.get('content-type') || 'text/plain; charset=utf-8',
    };
  } finally {
    cancel();
  }
}

async function fetchSubscription(target) {
  const cache = caches.default;
  const cacheKey = new Request(`https://proxyharvest-cache.invalid/fetch?url=${encodeURIComponent(target.toString())}`, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) {
    const data = await cached.json();
    return { ...data, cached: true, cacheAgeHintSeconds: CACHE_TTL_SECONDS };
  }

  const result = await fetchWithLimit(target);
  const payload = {
    ok: result.ok,
    status: result.status,
    latencyMs: result.latencyMs,
    text: result.body,
    bytes: result.bytes,
    sourceHost: target.hostname,
    cached: false,
    version: VERSION,
  };

  if (result.ok) {
    const cacheResponse = new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
      },
    });
    await cache.put(cacheKey, cacheResponse);
  }
  return payload;
}

async function probeHost(host, port) {
  const { hostname, port: nport } = ensureProbeTarget(host, port);
  const started = Date.now();
  const scheme = [80, 8080, 8880].includes(nport) ? 'http' : 'https';
  const url = `${scheme}://${hostname.includes(':') ? `[${hostname}]` : hostname}:${nport}/`;
  const { controller, cancel } = abortAfter(PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    return {
      ok: true,
      reachable: true,
      host: hostname,
      port: nport,
      scheme,
      status: response.status,
      latencyMs: Date.now() - started,
      method: 'worker-http-probe',
      confidence: 'medium',
      tunnelVerified: false,
      protocolVerified: false,
      note: 'Endpoint reachability only; this does not verify proxy protocol or tunnel egress.',
    };
  } catch (error) {
    return {
      ok: false,
      reachable: false,
      host: hostname,
      port: nport,
      scheme,
      latencyMs: Date.now() - started,
      method: 'worker-http-probe',
      confidence: 'low',
      tunnelVerified: false,
      protocolVerified: false,
      error: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error),
    };
  } finally {
    cancel();
  }
}

function adminPage(origin) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ProxyHarvest Gateway</title><style>body{font:15px system-ui;background:#07111f;color:#dbeafe;margin:0;padding:32px}main{max-width:760px;margin:auto;background:#0d1b2e;border:1px solid #1e3a5f;border-radius:18px;padding:24px;box-shadow:0 24px 70px #0008}code{background:#07111f;padding:3px 7px;border-radius:6px;color:#67e8f9}li{margin:10px 0}.ok{color:#4ade80}</style><main><h1>${SERVICE}</h1><p class="ok">Online · v${VERSION}</p><p>Read-only status page. No Cloudflare credentials are exposed here.</p><ul><li><code>GET ${origin}/health</code></li><li><code>GET ${origin}/fetch-sub?url=...</code> — approved subscription sources</li><li><code>GET ${origin}/probe?host=...&port=...</code> — reachability only</li><li><code>GET ${origin}/?url=...</code> — legacy raw CORS compatibility</li></ul></main>`;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
    if (!['GET', 'HEAD'].includes(request.method)) return json({ ok: false, error: 'method-not-allowed' }, 405, { Allow: 'GET,HEAD,OPTIONS' });

    const url = new URL(request.url);
    const origin = url.origin;

    try {
      if (url.pathname === '/health') {
        return json({
          ok: true,
          service: SERVICE,
          version: VERSION,
          timestamp: new Date().toISOString(),
          endpoints: ['/health', '/fetch-sub', '/probe', '/__admin'],
          sourceHostAllowlistSize: ALLOWED_SOURCE_HOSTS.size,
          maxBodyBytes: MAX_BODY_BYTES,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
        });
      }

      if (url.pathname === '/__admin') return html(adminPage(origin));

      if (url.pathname === '/probe') {
        const result = await probeHost(url.searchParams.get('host'), url.searchParams.get('port'));
        return json(result, result.ok ? 200 : 502);
      }

      if (url.pathname === '/fetch-sub') {
        const target = ensureAllowedSourceUrl(url.searchParams.get('url'));
        const result = await fetchSubscription(target);
        return json(result, result.ok ? 200 : 502, { 'X-ProxyHarvest-Cache': result.cached ? 'HIT' : 'MISS' });
      }

      // Legacy CORS-proxy compatibility used by CORS_PROXY_POOL tier-1.
      if (url.pathname === '/' && url.searchParams.has('url')) {
        const target = ensureAllowedSourceUrl(url.searchParams.get('url'));
        const result = await fetchWithLimit(target);
        return raw(result.body, result.ok ? 200 : 502, result.contentType, {
          'X-ProxyHarvest-Upstream-Status': String(result.status),
          'X-ProxyHarvest-Latency-Ms': String(result.latencyMs),
        });
      }

      return json({ ok: false, error: 'not-found', service: SERVICE, version: VERSION }, 404);
    } catch (error) {
      const message = String(error?.message || error || 'unknown-error');
      const status = ['invalid-url', 'https-required', 'credentials-not-allowed', 'blocked-host', 'source-host-not-allowed', 'invalid-port'].includes(message) ? 400 : message === 'response-too-large' ? 413 : 502;
      return json({ ok: false, error: message, service: SERVICE, version: VERSION }, status);
    }
  },
};
