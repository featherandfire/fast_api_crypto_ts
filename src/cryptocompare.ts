import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { settings } from './config.ts';
import { fetchTopCoins } from './coingecko.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = resolve(__dirname, '..', 'cryptocompare_cache.json');

const BASE = settings.cryptocompare_base_url;
const API_KEY = settings.cryptocompare_api_key;

const CHANGE_TTL = 86_400_000; // 24h
const VOL_TTL = 86_400_000;
const DAYS_LIST = [548];
const VOL_PERIODS = [90, 180, 365];

// key = "SYM:days" → { at: wall-clock ms, value: pct_change | null }
const changeCache = new Map<string, { at: number; value: number | null }>();
const volCache = new Map<string, { at: number; value: number | null }>();

// ── Disk persistence ────────────────────────────────────────────────────────

function loadCacheFromDisk() {
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as {
      changes?: Record<string, [number, number | null]>;
      vol?: Record<string, [number, number | null]>;
    };
    const now = Date.now();
    let loaded = 0;
    for (const [key, [ts, value]] of Object.entries(raw.changes ?? {})) {
      if (now - ts * 1000 < CHANGE_TTL) {
        changeCache.set(key, { at: ts * 1000, value });
        loaded++;
      }
    }
    for (const [key, [ts, value]] of Object.entries(raw.vol ?? {})) {
      if (now - ts * 1000 < VOL_TTL) {
        volCache.set(key, { at: ts * 1000, value });
        loaded++;
      }
    }
    console.log(`Loaded ${loaded} entries from CryptoCompare disk cache`);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      console.log('No CryptoCompare disk cache found — will build from scratch');
    } else {
      console.warn('Failed to load CryptoCompare disk cache:', e.message);
    }
  }
}

function saveCacheToDisk() {
  try {
    const changes: Record<string, [number, number | null]> = {};
    for (const [k, v] of changeCache) changes[k] = [v.at / 1000, v.value];
    const vol: Record<string, [number, number | null]> = {};
    for (const [k, v] of volCache) vol[k] = [v.at / 1000, v.value];
    writeFileSync(CACHE_FILE, JSON.stringify({ changes, vol }));
  } catch (err) {
    console.warn('Failed to save CryptoCompare disk cache:', err);
  }
}

// ── Low-level GET with retry on 429 ─────────────────────────────────────────

async function ccGet<T = any>(url: string, params: Record<string, string | number>): Promise<T | Record<string, never>> {
  const headers: Record<string, string> = {};
  if (API_KEY) headers['authorization'] = `Apikey ${API_KEY}`;
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();

  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const resp = await fetch(`${url}?${qs}`, { headers, signal: controller.signal });
      if (resp.status === 429) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
          continue;
        }
        return {};
      }
      if (!resp.ok) return {};
      const data = (await resp.json()) as any;
      if (data?.Response === 'Error') return {};
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }
  return {};
}

interface HistoDayPoint {
  close: number;
  time?: number;
}

async function fetchHistoDay(sym: string, days: number): Promise<HistoDayPoint[]> {
  const data = await ccGet<{ Data?: { Data?: HistoDayPoint[] } }>(
    `${BASE}/data/v2/histoday`,
    { fsym: sym, tsym: 'USD', limit: days },
  );
  return data?.Data?.Data ?? [];
}

async function fetchOneSymbolChange(sym: string, days: number): Promise<number | null> {
  try {
    const points = await fetchHistoDay(sym, days);
    if (points.length < 2) return null;
    const oldPrice = points[0]!.close;
    const newPrice = points[points.length - 1]!.close;
    if (!oldPrice || oldPrice <= 0) return null;
    return Math.round(((newPrice - oldPrice) / oldPrice) * 100 * 100) / 100;
  } catch {
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function fetchPctChanges(
  symbols: string[],
  daysList: number[],
): Promise<Record<string, Record<number, number | null>>> {
  const now = Date.now();
  const results: Record<string, Record<number, number | null>> = {};
  for (const sym of symbols) {
    for (const days of daysList) {
      const entry = changeCache.get(`${sym}:${days}`);
      if (entry && now - entry.at < CHANGE_TTL) {
        results[sym] ??= {};
        results[sym]![days] = entry.value;
      }
    }
  }
  return results;
}

export async function fetchVolatilities(
  symbols: string[],
  daysList: number[] = VOL_PERIODS,
): Promise<Record<string, Record<number, number | null>>> {
  const now = Date.now();
  const results: Record<string, Record<number, number | null>> = {};
  for (const sym of symbols) {
    for (const days of daysList) {
      const entry = volCache.get(`${sym}:${days}`);
      if (entry && now - entry.at < VOL_TTL) {
        results[sym] ??= {};
        results[sym]![days] = entry.value;
      }
    }
  }
  return results;
}

// ── Background prefetch ─────────────────────────────────────────────────────

let prefetchAbort: AbortController | null = null;

async function backgroundPrefetch(signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      const raw = await fetchTopCoins(200);
      const symbols = [
        ...new Set(raw.map((c) => c.symbol?.toUpperCase()).filter(Boolean)),
      ];
      const now = Date.now();

      const stale: Array<[string, number]> = [];
      for (const sym of symbols) {
        for (const days of DAYS_LIST) {
          const entry = changeCache.get(`${sym}:${days}`);
          if (!entry || now - entry.at >= CHANGE_TTL) stale.push([sym!, days]);
        }
      }

      if (stale.length === 0) {
        console.log(
          `CryptoCompare cache fully warm (${changeCache.size} entries), sleeping 24h`,
        );
      } else {
        console.log(
          `CryptoCompare prefetch: ${stale.length} stale of ${symbols.length * DAYS_LIST.length} total, fetching...`,
        );
        let fetched = 0;
        for (const [sym, days] of stale) {
          if (signal.aborted) return;
          const pct = await fetchOneSymbolChange(sym, days);
          changeCache.set(`${sym}:${days}`, { at: Date.now(), value: pct });
          fetched++;
          if (fetched % 20 === 0) saveCacheToDisk();
          await new Promise((r) => setTimeout(r, 1500));
        }
        saveCacheToDisk();
        console.log(`CryptoCompare change prefetch complete: ${fetched} fetched`);
      }
    } catch (err) {
      console.error('CryptoCompare background prefetch error:', err);
    }

    await new Promise((r) => setTimeout(r, 86_400_000));
  }
}

export function startBackgroundPrefetch() {
  loadCacheFromDisk();
  if (prefetchAbort) return;
  prefetchAbort = new AbortController();
  void backgroundPrefetch(prefetchAbort.signal);
  console.log('CryptoCompare background prefetch task started');
}

export function stopBackgroundPrefetch() {
  saveCacheToDisk();
  if (prefetchAbort) {
    prefetchAbort.abort();
    prefetchAbort = null;
  }
}
