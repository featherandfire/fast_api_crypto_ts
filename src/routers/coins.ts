import type { FastifyInstance } from 'fastify';
import { desc, eq, isNotNull } from 'drizzle-orm';

import {
  fetchPriceHistory,
  fetchTopCoins,
  fetchYearlyRanges,
  searchCoins,
} from '../coingecko.ts';
import { db } from '../db/client.ts';
import { coins } from '../db/schema.ts';

function nowIso() {
  return new Date().toISOString();
}

export async function coinsRouter(app: FastifyInstance) {
  // ── /api/coins/top — upsert into DB, fall back to DB on CoinGecko error ──
  app.get<{ Querystring: { limit?: string } }>('/api/coins/top', async (req) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);

    let raw: Awaited<ReturnType<typeof fetchTopCoins>>;
    try {
      raw = await fetchTopCoins(limit);
    } catch (err) {
      app.log.warn({ err }, 'CoinGecko /coins/top failed — falling back to DB');
      const rows = db
        .select()
        .from(coins)
        .where(isNotNull(coins.last_updated))
        .orderBy(desc(coins.market_cap))
        .limit(limit)
        .all();
      // Coerce numeric TEXT columns to numbers so the frontend can compute
      // with them identically whether live or cached.
      return rows.map((r) => ({
        ...r,
        current_price_usd:
          r.current_price_usd != null ? Number(r.current_price_usd) : null,
        price_change_24h:
          r.price_change_24h != null ? Number(r.price_change_24h) : null,
        market_cap: r.market_cap != null ? Number(r.market_cap) : null,
        circulating_supply:
          r.circulating_supply != null ? Number(r.circulating_supply) : null,
        max_supply: r.max_supply != null ? Number(r.max_supply) : null,
      }));
    }

    const now = nowIso();
    for (const item of raw) {
      const existing = db
        .select()
        .from(coins)
        .where(eq(coins.coingecko_id, item.id))
        .get();

      const patch = {
        current_price_usd:
          item.current_price != null ? String(item.current_price) : null,
        price_change_24h:
          item.price_change_percentage_24h != null
            ? String(item.price_change_percentage_24h)
            : null,
        market_cap: item.market_cap != null ? String(item.market_cap) : null,
        image_url: item.image ?? null,
        last_updated: now,
        circulating_supply:
          item.circulating_supply != null
            ? String(item.circulating_supply)
            : null,
        max_supply:
          item.max_supply != null ? String(item.max_supply) : null,
      };

      if (existing) {
        db.update(coins).set(patch).where(eq(coins.id, existing.id)).run();
      } else {
        db.insert(coins)
          .values({
            coingecko_id: item.id,
            symbol: item.symbol,
            name: item.name,
            ...patch,
          })
          .run();
      }
    }

    // Merge supply + long-range change fields not stored in DB.
    return raw.map((item) => {
      const row = db
        .select()
        .from(coins)
        .where(eq(coins.coingecko_id, item.id))
        .get();
      return {
        id: row?.id,
        coingecko_id: item.id,
        symbol: item.symbol,
        name: item.name,
        current_price_usd: item.current_price ?? null,
        price_change_24h: item.price_change_percentage_24h ?? null,
        market_cap: item.market_cap ?? null,
        image_url: item.image ?? null,
        last_updated: now,
        circulating_supply: item.circulating_supply ?? null,
        max_supply: item.max_supply ?? null,
        price_change_200d:
          item.price_change_percentage_200d_in_currency ?? null,
        price_change_1y: item.price_change_percentage_1y_in_currency ?? null,
      };
    });
  });

  // ── /api/coins/yearly-ranges — served from cache (prefetch not ported) ──
  app.get<{ Querystring: { ids?: string } }>(
    '/api/coins/yearly-ranges',
    async (req, reply) => {
      const ids = (req.query.ids ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 50);
      if (!ids.length) {
        return reply.code(422).send({ detail: 'ids required' });
      }
      return fetchYearlyRanges(ids);
    },
  );

  // ── /api/coins/supply ────────────────────────────────────────────────────
  app.get<{ Querystring: { limit?: string } }>(
    '/api/coins/supply',
    async (req) => {
      const limit = Math.min(Math.max(Number(req.query.limit ?? 200) || 200, 1), 250);
      const raw = await fetchTopCoins(limit);
      const out: Record<string, { circulating_supply: number | null; max_supply: number | null }> = {};
      for (const item of raw) {
        out[item.symbol.toUpperCase()] = {
          circulating_supply: item.circulating_supply ?? null,
          max_supply: item.max_supply ?? null,
        };
      }
      return out;
    },
  );

  // ── /api/coins/search ────────────────────────────────────────────────────
  app.get<{ Querystring: { q?: string } }>(
    '/api/coins/search',
    async (req, reply) => {
      const q = (req.query.q ?? '').trim();
      if (!q) return reply.code(422).send({ detail: 'q required' });
      return searchCoins(q);
    },
  );

  // ── /api/coins/:id/history ───────────────────────────────────────────────
  app.get<{
    Params: { coingecko_id: string };
    Querystring: { days?: string };
  }>('/api/coins/:coingecko_id/history', async (req, reply) => {
    const days = Math.min(Math.max(Number(req.query.days ?? 30) || 30, 1), 365);
    try {
      const raw = await fetchPriceHistory(req.params.coingecko_id, days);
      return {
        coingecko_id: req.params.coingecko_id,
        prices: raw.map(([timestamp, price]) => ({ timestamp, price })),
      };
    } catch (err) {
      const msg = String(err);
      if (msg.includes('429')) {
        return reply.code(502).send({
          detail: 'CoinGecko rate limit — try again in a moment',
        });
      }
      return reply
        .code(502)
        .send({ detail: 'Failed to fetch price history from CoinGecko' });
    }
  });
}
