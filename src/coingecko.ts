import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { settings } from './config.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const YEARLY_CACHE_FILE = resolve(__dirname, '..', 'coingecko_yearly_cache.json');

const BASE = settings.coingecko_base_url;
const TOP_TTL = 300_000;       // 5 min
const HISTORY_TTL = 300_000;   // 5 min
const YEARLY_TTL = 86_400_000; // 24h
const PRICES_TTL = 30_000;     // 30 s — CoinGecko itself only updates this often

// ── Caches ───────────────────────────────────────────────────────────────────

const topCache = new Map<number, { at: number; data: RawCoin[] }>();
const historyCache = new Map<string, { at: number; data: [number, number][] }>();
const pricesCache = new Map<string, { at: number; data: PriceRecord }>();
export const yearlyCache = new Map<string, { at: number; data: YearlyEntry }>();

// ── Types ────────────────────────────────────────────────────────────────────

export interface RawCoin {
  id: string;
  symbol: string;
  name: string;
  current_price?: number | null;
  price_change_percentage_24h?: number | null;
  market_cap?: number | null;
  image?: string | null;
  circulating_supply?: number | null;
  max_supply?: number | null;
  price_change_percentage_200d_in_currency?: number | null;
  price_change_percentage_1y_in_currency?: number | null;
}

export interface PriceRecord {
  coingecko_id: string;
  symbol: string;
  name: string;
  current_price_usd: number | null;
  price_change_24h: number | null;
  market_cap: number | null;
  image_url: string | null;
}

export interface YearlyEntry {
  high_1y?: number;
  low_1y?: number;
  vol_90d?: number | null;
  vol_180d?: number | null;
  vol_365d?: number | null;
}

// ── Low-level GET with retry on 429 ──────────────────────────────────────────

async function get<T = unknown>(url: string, params?: Record<string, string | number>): Promise<T> {
  const qs = params
    ? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
    : '';
  const full = url + qs;

  const backoff = 1500;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const resp = await fetch(full, { signal: controller.signal });
      if (resp.status === 429 && attempt < 2) {
        await new Promise((r) => setTimeout(r, backoff * 2 ** attempt));
        continue;
      }
      if (!resp.ok) throw new Error(`CoinGecko ${resp.status} ${resp.statusText}`);
      return (await resp.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('CoinGecko retry exhausted');
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function fetchTopCoins(limit = 50): Promise<RawCoin[]> {
  const cached = topCache.get(limit);
  if (cached && Date.now() - cached.at < TOP_TTL) return cached.data;

  const data = await get<RawCoin[]>(`${BASE}/coins/markets`, {
    vs_currency: 'usd',
    order: 'market_cap_desc',
    per_page: limit,
    page: 1,
    sparkline: 'false',
    price_change_percentage: '24h,200d,1y',
  });
  topCache.set(limit, { at: Date.now(), data });
  return data;
}

export async function fetchPrices(coinIds: string[]): Promise<Record<string, PriceRecord>> {
  if (coinIds.length === 0) return {};

  const now = Date.now();
  const results: Record<string, PriceRecord> = {};
  const toFetch: string[] = [];

  // Serve fresh per-coin entries from cache; only call CoinGecko for misses/stale.
  for (const id of coinIds) {
    const cached = pricesCache.get(id);
    if (cached && now - cached.at < PRICES_TTL) {
      results[id] = cached.data;
    } else {
      toFetch.push(id);
    }
  }

  if (toFetch.length === 0) return results;

  const batches: string[][] = [];
  for (let i = 0; i < toFetch.length; i += 50) batches.push(toFetch.slice(i, i + 50));

  const batchResults = await Promise.allSettled(
    batches.map((ids) =>
      get<RawCoin[]>(`${BASE}/coins/markets`, {
        vs_currency: 'usd',
        ids: ids.join(','),
        order: 'market_cap_desc',
        per_page: ids.length,
        page: 1,
        sparkline: 'false',
        price_change_percentage: '24h',
      }),
    ),
  );

  const fetchedAt = Date.now();
  for (const r of batchResults) {
    if (r.status !== 'fulfilled') continue;
    for (const coin of r.value) {
      const rec: PriceRecord = {
        coingecko_id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        current_price_usd: coin.current_price ?? null,
        price_change_24h: coin.price_change_percentage_24h ?? null,
        market_cap: coin.market_cap ?? null,
        image_url: coin.image ?? null,
      };
      results[coin.id] = rec;
      pricesCache.set(coin.id, { at: fetchedAt, data: rec });
    }
  }
  return results;
}

export async function fetchPriceHistory(
  coinId: string,
  days = 30,
): Promise<[number, number][]> {
  const key = `${coinId}:${days}`;
  const cached = historyCache.get(key);
  if (cached && Date.now() - cached.at < HISTORY_TTL) return cached.data;

  const data = await get<{ prices?: [number, number][] }>(
    `${BASE}/coins/${coinId}/market_chart`,
    { vs_currency: 'usd', days },
  );
  const prices = data.prices ?? [];
  historyCache.set(key, { at: Date.now(), data: prices });
  return prices;
}

export async function searchCoins(query: string) {
  const data = await get<{ coins?: Array<{ id: string; name: string; symbol: string; thumb?: string }> }>(
    `${BASE}/search`,
    { query },
  );
  return (data.coins ?? []).slice(0, 20).map((c) => ({
    id: c.id,
    name: c.name,
    symbol: c.symbol,
    thumb: c.thumb ?? null,
  }));
}

export interface ContractMatch {
  coingecko_id: string;
  name: string;
  symbol: string;
  current_price_usd: number | null;
  image_url: string | null;
}

// Mirror of app/coingecko.py::match_tokens_by_contract. Looks up CoinGecko
// metadata for a list of Ethereum contract addresses, with a concurrency
// cap (free-tier limits ~30 req/min). Unmatched addresses are omitted.
export async function matchTokensByContract(
  addresses: string[],
): Promise<Record<string, ContractMatch>> {
  if (addresses.length === 0) return {};
  const CONCURRENCY = 3;
  const out: Record<string, ContractMatch> = {};
  let idx = 0;

  async function worker() {
    while (idx < addresses.length) {
      const i = idx++;
      const address = addresses[i];
      if (!address) continue;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        const resp = await fetch(
          `${BASE}/coins/ethereum/contract/${address}`,
          { signal: controller.signal },
        );
        clearTimeout(timer);
        if (resp.status === 404 || resp.status === 429 || !resp.ok) continue;
        const data = (await resp.json()) as {
          id: string;
          name: string;
          symbol: string;
          market_data?: { current_price?: { usd?: number } };
          image?: { small?: string };
        };
        out[address.toLowerCase()] = {
          coingecko_id: data.id,
          name: data.name,
          symbol: data.symbol,
          current_price_usd: data.market_data?.current_price?.usd ?? null,
          image_url: data.image?.small ?? null,
        };
      } catch {
        // ignore — unmatched addresses are silently omitted
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return out;
}

export async function fetchYearlyRanges(coinIds: string[]): Promise<Record<string, YearlyEntry>> {
  const out: Record<string, YearlyEntry> = {};
  const now = Date.now();
  for (const id of coinIds) {
    const entry = yearlyCache.get(id);
    if (entry && now - entry.at < YEARLY_TTL && Object.keys(entry.data).length) {
      out[id] = entry.data;
    }
  }
  return out;
}

// ── Yearly background prefetch ──────────────────────────────────────────────

function loadYearlyCache() {
  try {
    const raw = JSON.parse(readFileSync(YEARLY_CACHE_FILE, 'utf-8')) as Record<
      string,
      [number, YearlyEntry]
    >;
    const now = Date.now();
    let loaded = 0;
    for (const [key, [ts, data]] of Object.entries(raw)) {
      if (now - ts * 1000 < YEARLY_TTL) {
        yearlyCache.set(key, { at: ts * 1000, data });
        loaded++;
      }
    }
    console.log(`Loaded ${loaded} entries from CoinGecko yearly disk cache`);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      console.log('No CoinGecko yearly disk cache found — will build from API');
    } else {
      console.warn('Failed to load CoinGecko yearly disk cache:', e.message);
    }
  }
}

function saveYearlyCache() {
  try {
    const out: Record<string, [number, YearlyEntry]> = {};
    for (const [k, v] of yearlyCache) out[k] = [v.at / 1000, v.data];
    writeFileSync(YEARLY_CACHE_FILE, JSON.stringify(out));
  } catch (err) {
    console.warn('Failed to save CoinGecko yearly disk cache:', err);
  }
}

function calcVolatility(prices: number[], tailN: number): number | null {
  const pts = prices.length >= tailN ? prices.slice(-tailN) : prices;
  if (pts.length < 10) return null;
  const returns: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]!;
    if (prev > 0) returns.push((pts[i]! - prev) / prev);
  }
  if (returns.length < 5) return null;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.round(Math.sqrt(variance) * Math.sqrt(365) * 10_000) / 10_000;
}

async function fetchOneYearly(coinId: string): Promise<YearlyEntry | null> {
  try {
    const data = await get<{ prices?: [number, number][] }>(
      `${BASE}/coins/${coinId}/market_chart`,
      { vs_currency: 'usd', days: 365 },
    );
    const prices = (data.prices ?? []).map(([, p]) => p);
    if (!prices.length) return null;
    return {
      high_1y: Math.max(...prices),
      low_1y: Math.min(...prices),
      vol_90d: calcVolatility(prices, 90),
      vol_180d: calcVolatility(prices, 180),
      vol_365d: calcVolatility(prices, 365),
    };
  } catch {
    return null;
  }
}

let yearlyAbort: AbortController | null = null;

async function yearlyBackgroundPrefetch(signal: AbortSignal) {
  // Let the server finish booting before hammering CoinGecko.
  await new Promise((r) => setTimeout(r, 10_000));

  while (!signal.aborted) {
    try {
      // Prefer the live top-200 list; if CoinGecko 429s, fall back to the
      // IDs we already have cached so a partially-warm cache can still be
      // filled in without a fresh /coins/markets call.
      let coinIds: string[];
      try {
        const raw = await fetchTopCoins(200);
        coinIds = raw.map((c) => c.id).filter(Boolean);
      } catch (err) {
        if (yearlyCache.size > 0) {
          console.log(
            `fetchTopCoins failed (${String(err)}), backfilling from ${yearlyCache.size} cached IDs`,
          );
          coinIds = [...yearlyCache.keys()];
        } else {
          throw err;
        }
      }
      const now = Date.now();
      const HOT_COUNT = 150;
      const hotIds = coinIds.slice(0, HOT_COUNT);
      const coldIds = coinIds.slice(HOT_COUNT);

      // Hot coins (top 150 by market cap): retry until vol data populated.
      const staleHot = hotIds.filter((cid) => {
        const entry = yearlyCache.get(cid);
        if (!entry) return true;
        if (now - entry.at >= YEARLY_TTL) return true;
        return !entry.data || entry.data.vol_90d == null;
      });

      // Cold coins (151+): one-shot — if we already tried and got nothing,
      // don't keep burning quota retrying. Revisit on the 24h cycle.
      const staleCold = coldIds.filter((cid) => {
        const entry = yearlyCache.get(cid);
        return !entry || now - entry.at >= YEARLY_TTL;
      });

      const stale = [...staleHot, ...staleCold];

      if (stale.length === 0) {
        console.log(
          `CoinGecko yearly cache fully warm (${yearlyCache.size} entries), sleeping 24h`,
        );
      } else {
        console.log(
          `CoinGecko yearly prefetch: ${stale.length} stale of ${coinIds.length} total`,
        );
        let fetched = 0;
        for (const cid of stale) {
          if (signal.aborted) return;
          const result = await fetchOneYearly(cid);
          yearlyCache.set(cid, { at: Date.now(), data: result ?? {} });
          fetched++;
          if (fetched % 10 === 0) saveYearlyCache();
          await new Promise((r) => setTimeout(r, 3000));
        }
        saveYearlyCache();
        console.log(`CoinGecko yearly prefetch complete: ${fetched} fetched`);
      }
    } catch (err) {
      console.error(
        'CoinGecko yearly background prefetch error:',
        err,
        '— retrying in 5 min',
      );
      await new Promise((r) => setTimeout(r, 300_000));
      continue;
    }

    // If any HOT (top 150) entries are still empty (429s mid-cycle), loop
    // again after a short cooldown. Cold (151-200) misses wait 24h.
    // Map preserves insertion order, which is market-cap-descending here.
    const hotKeys = [...yearlyCache.keys()].slice(0, 150);
    const stillEmptyHot = hotKeys.filter((cid) => {
      const e = yearlyCache.get(cid);
      return !e || !e.data || e.data.vol_90d == null;
    }).length;
    if (stillEmptyHot > 0) {
      console.log(
        `CoinGecko yearly: ${stillEmptyHot} top-150 entries still empty — retrying in 2 min`,
      );
      await new Promise((r) => setTimeout(r, 120_000));
    } else {
      await new Promise((r) => setTimeout(r, 86_400_000));
    }
  }
}

export function startYearlyPrefetch() {
  loadYearlyCache();
  if (yearlyAbort) return;
  yearlyAbort = new AbortController();
  void yearlyBackgroundPrefetch(yearlyAbort.signal);
  console.log('CoinGecko yearly background prefetch task started');
}

export function stopYearlyPrefetch() {
  saveYearlyCache();
  if (yearlyAbort) {
    yearlyAbort.abort();
    yearlyAbort = null;
  }
}
