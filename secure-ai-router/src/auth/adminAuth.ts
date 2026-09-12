export const ADMIN_TOKEN_STORAGE_KEY = 'cloudflare-ai-router.adminToken';

export function getStoredAdminToken(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? '';
}

export function setStoredAdminToken(token: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = token.trim();
  if (trimmed) window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, trimmed);
  else window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
}

export function clearStoredAdminToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
}

export function hasStoredAdminToken(): boolean {
  return getStoredAdminToken().length > 0;
}

export function buildAdminHeaders(includeJson = false): HeadersInit {
  const token = getStoredAdminToken();
  const headers: Record<string, string> = includeJson ? { 'Content-Type': 'application/json' } : {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function fetchAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  const includeJson = typeof init.body === 'string' || init.method === 'POST' || init.method === 'PUT' || init.method === 'PATCH';
  return fetch(path, {
    ...init,
    headers: {
      ...buildAdminHeaders(includeJson),
      ...(init.headers ?? {}),
    },
  });
}
