import { settings } from './config.ts';

let cachedToken: string | null = null;
let cachedExpiresAt = 0; // ms epoch
let pending: Promise<string> | null = null;

async function getToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedExpiresAt > now + 30_000) return cachedToken;

  // Concurrency-safe: collapse parallel callers onto a single in-flight request.
  if (pending) return pending;

  pending = (async () => {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: settings.paxos_client_id,
      client_secret: settings.paxos_client_secret,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const resp = await fetch(settings.paxos_oauth_url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`Paxos OAuth ${resp.status} ${resp.statusText}`);
      const data = (await resp.json()) as { access_token: string; expires_in?: number };
      cachedToken = data.access_token;
      cachedExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
      return cachedToken;
    } finally {
      clearTimeout(timer);
      pending = null;
    }
  })();

  return pending;
}

export async function paxosGet<T = any>(path: string, params?: Record<string, string>): Promise<T> {
  const token = await getToken();
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(`${settings.paxos_base_url}${path}${qs}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      const err = new Error(`Paxos ${resp.status}: ${resp.statusText} — ${text}`);
      (err as any).status = resp.status;
      throw err;
    }
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function unwrapItems<T>(data: any, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  return (data?.[key] ?? data?.items ?? []) as T[];
}

export async function fetchBalances(profileId: string): Promise<any[]> {
  const data = await paxosGet<any>(`/profiles/${profileId}/balances`);
  return unwrapItems(data, 'items');
}

export async function fetchMarkets(): Promise<any[]> {
  const data = await paxosGet<any>('/markets');
  return unwrapItems(data, 'markets');
}

export async function fetchTicker(market: string): Promise<any> {
  return paxosGet(`/markets/${market}/ticker`);
}
