import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';

import { getCurrentUser } from '../auth.ts';
import { fetchPrices } from '../coingecko.ts';
import { db } from '../db/client.ts';
import {
  coins,
  holdings,
  portfolios,
  transactions,
} from '../db/schema.ts';

// Mirror of app/routers/portfolio.py. Endpoints that depend on a live
// CoinGecko client (price refresh, add-holding coin lookup) are stubbed
// with 501 until coingecko.ts is ported.

type Holding = typeof holdings.$inferSelect;
type Coin = typeof coins.$inferSelect;

type HoldingWithCoin = Holding & { coin: Coin };

function toFloat(v: string | null): number | null {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function nowIso() {
  return new Date().toISOString();
}

async function getOrCreateCoin(coingeckoId: string): Promise<Coin | null> {
  const existing = db
    .select()
    .from(coins)
    .where(eq(coins.coingecko_id, coingeckoId))
    .get();
  if (existing) return existing;

  const data = await fetchPrices([coingeckoId]);
  const d = data[coingeckoId];
  if (!d) return null;

  db.insert(coins)
    .values({
      coingecko_id: coingeckoId,
      symbol: d.symbol,
      name: d.name,
      current_price_usd: d.current_price_usd != null ? String(d.current_price_usd) : null,
      price_change_24h: d.price_change_24h != null ? String(d.price_change_24h) : null,
      market_cap: d.market_cap != null ? String(d.market_cap) : null,
      image_url: d.image_url,
      last_updated: nowIso(),
    })
    .run();

  return db.select().from(coins).where(eq(coins.coingecko_id, coingeckoId)).get() ?? null;
}

async function refreshHoldingPrices(rows: { holding: Holding; coin: Coin }[]) {
  const ids = [...new Set(rows.map((r) => r.coin.coingecko_id))];
  if (ids.length === 0) return;
  const prices = await fetchPrices(ids);
  const now = nowIso();
  for (const { coin } of rows) {
    const p = prices[coin.coingecko_id];
    if (!p) continue;
    db.update(coins)
      .set({
        current_price_usd:
          p.current_price_usd != null ? String(p.current_price_usd) : null,
        price_change_24h:
          p.price_change_24h != null ? String(p.price_change_24h) : null,
        last_updated: now,
      })
      .where(eq(coins.id, coin.id))
      .run();
    coin.current_price_usd =
      p.current_price_usd != null ? String(p.current_price_usd) : null;
    coin.price_change_24h =
      p.price_change_24h != null ? String(p.price_change_24h) : null;
  }
}

function computeHoldingValue(h: HoldingWithCoin) {
  const price = toFloat(h.coin.current_price_usd);
  const amount = toFloat(h.amount) ?? 0;
  const current_value_usd = price !== null ? amount * price : null;
  const avg = toFloat(h.avg_buy_price) ?? 0;
  const cost = avg * amount;
  const pnl_usd = current_value_usd !== null ? current_value_usd - cost : null;
  const pnl_pct =
    pnl_usd !== null && cost > 0 ? (pnl_usd / cost) * 100 : null;

  return {
    id: h.id,
    amount,
    avg_buy_price: toFloat(h.avg_buy_price),
    created_at: h.created_at,
    updated_at: h.updated_at,
    coin: {
      id: h.coin.id,
      coingecko_id: h.coin.coingecko_id,
      symbol: h.coin.symbol,
      name: h.coin.name,
      current_price_usd: toFloat(h.coin.current_price_usd),
      price_change_24h: toFloat(h.coin.price_change_24h),
      market_cap: toFloat(h.coin.market_cap),
      image_url: h.coin.image_url,
      last_updated: h.coin.last_updated,
    },
    current_value_usd,
    pnl_usd,
    pnl_pct,
  };
}

export async function portfolioRouter(app: FastifyInstance) {
  // ── List ──────────────────────────────────────────────────────────────────
  app.get('/api/portfolios', async () => {
    const user = await getCurrentUser();
    return db
      .select()
      .from(portfolios)
      .where(eq(portfolios.user_id, user.id))
      .all();
  });

  // ── Create ────────────────────────────────────────────────────────────────
  app.post<{ Body: { name: string } }>('/api/portfolios', async (req, reply) => {
    const user = await getCurrentUser();
    const name = req.body?.name?.trim();
    if (!name || name.length > 100) {
      return reply.code(422).send({ detail: 'name is required (max 100 chars)' });
    }
    const result = db
      .insert(portfolios)
      .values({ user_id: user.id, name })
      .returning()
      .get();
    return reply.code(201).send(result);
  });

  // ── Detail (with holdings + computed values) ─────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/api/portfolios/:id',
    async (req, reply) => {
      const user = await getCurrentUser();
      const id = Number(req.params.id);

      const portfolio = db
        .select()
        .from(portfolios)
        .where(and(eq(portfolios.id, id), eq(portfolios.user_id, user.id)))
        .get();

      if (!portfolio) return reply.code(404).send({ detail: 'Portfolio not found' });

      const rows = db
        .select({ holding: holdings, coin: coins })
        .from(holdings)
        .innerJoin(coins, eq(holdings.coin_id, coins.id))
        .where(eq(holdings.portfolio_id, id))
        .all();

      // Refresh prices from CoinGecko (best-effort — falls back to stored
      // price on error, matching Python's behavior).
      try {
        await refreshHoldingPrices(rows);
      } catch (err) {
        app.log.warn({ err }, 'Price refresh failed — using stored prices');
      }

      const holdings_out = rows.map(({ holding, coin }) =>
        computeHoldingValue({ ...holding, coin }),
      );

      const total_value_usd = holdings_out.reduce(
        (s, h) => s + (h.current_value_usd ?? 0),
        0,
      );
      const total_cost_usd = holdings_out.reduce(
        (s, h) => s + (h.avg_buy_price ?? 0) * h.amount,
        0,
      );
      const total_pnl_usd = total_value_usd - total_cost_usd;
      const total_pnl_pct =
        total_cost_usd > 0 ? (total_pnl_usd / total_cost_usd) * 100 : null;

      return {
        ...portfolio,
        holdings: holdings_out,
        total_value_usd,
        total_cost_usd,
        total_pnl_usd,
        total_pnl_pct,
      };
    },
  );

  // ── Delete portfolio ──────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>(
    '/api/portfolios/:id',
    async (req, reply) => {
      const user = await getCurrentUser();
      const id = Number(req.params.id);
      const portfolio = db
        .select()
        .from(portfolios)
        .where(and(eq(portfolios.id, id), eq(portfolios.user_id, user.id)))
        .get();
      if (!portfolio) return reply.code(404).send({ detail: 'Portfolio not found' });

      db.delete(portfolios).where(eq(portfolios.id, id)).run();
      return reply.code(204).send();
    },
  );

  // ── Add holding ──────────────────────────────────────────────────────────
  app.post<{
    Params: { id: string };
    Body: {
      coingecko_id: string;
      amount: number;
      avg_buy_price?: number | null;
      wallet_address?: string | null;
    };
  }>('/api/portfolios/:id/holdings', async (req, reply) => {
    const user = await getCurrentUser();
    const pid = Number(req.params.id);

    const portfolio = db
      .select()
      .from(portfolios)
      .where(and(eq(portfolios.id, pid), eq(portfolios.user_id, user.id)))
      .get();
    if (!portfolio) return reply.code(404).send({ detail: 'Portfolio not found' });

    const body = req.body ?? ({} as typeof req.body);
    if (!body.coingecko_id) {
      return reply.code(422).send({ detail: 'coingecko_id required' });
    }
    if (!(body.amount > 0)) {
      return reply.code(422).send({ detail: 'amount must be > 0' });
    }

    const coin = await getOrCreateCoin(body.coingecko_id);
    if (!coin) {
      return reply.code(404).send({
        detail: `Coin '${body.coingecko_id}' not found on CoinGecko`,
      });
    }

    const walletAddress = body.wallet_address?.toLowerCase() ?? null;

    // SQLite treats NULLs as distinct in UNIQUE indexes, so the lookup must
    // match NULL explicitly when no wallet is provided.
    const existing = db
      .select()
      .from(holdings)
      .where(
        and(
          eq(holdings.portfolio_id, pid),
          eq(holdings.coin_id, coin.id),
          walletAddress === null
            ? sql`${holdings.wallet_address} IS NULL`
            : eq(holdings.wallet_address, walletAddress),
        ),
      )
      .get();
    if (existing) {
      return reply
        .code(409)
        .send({ detail: 'Coin already in portfolio for this wallet; use PATCH to update' });
    }

    const inserted = db
      .insert(holdings)
      .values({
        portfolio_id: pid,
        coin_id: coin.id,
        wallet_address: walletAddress,
        amount: String(body.amount),
        avg_buy_price:
          body.avg_buy_price != null ? String(body.avg_buy_price) : null,
      })
      .returning()
      .get();

    return reply.code(201).send({ ...inserted, coin });
  });

  // ── Update holding ────────────────────────────────────────────────────────
  app.patch<{
    Params: { id: string; holding_id: string };
    Body: { amount?: number; avg_buy_price?: number };
  }>('/api/portfolios/:id/holdings/:holding_id', async (req, reply) => {
    const user = await getCurrentUser();
    const pid = Number(req.params.id);
    const hid = Number(req.params.holding_id);

    const row = db
      .select({ holding: holdings })
      .from(holdings)
      .innerJoin(portfolios, eq(holdings.portfolio_id, portfolios.id))
      .where(
        and(
          eq(holdings.id, hid),
          eq(holdings.portfolio_id, pid),
          eq(portfolios.user_id, user.id),
        ),
      )
      .get();
    if (!row) return reply.code(404).send({ detail: 'Holding not found' });

    const { amount, avg_buy_price } = req.body ?? {};
    if (amount === undefined && avg_buy_price === undefined) {
      return reply.code(422).send({
        detail: 'Provide at least one of: amount, avg_buy_price',
      });
    }

    const patch: Partial<typeof holdings.$inferInsert> = {
      updated_at: new Date().toISOString(),
    };
    if (amount !== undefined) patch.amount = String(amount);
    if (avg_buy_price !== undefined) patch.avg_buy_price = String(avg_buy_price);

    const updated = db
      .update(holdings)
      .set(patch)
      .where(eq(holdings.id, hid))
      .returning()
      .get();

    return updated;
  });

  // ── Delete holding ────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string; holding_id: string } }>(
    '/api/portfolios/:id/holdings/:holding_id',
    async (req, reply) => {
      const user = await getCurrentUser();
      const pid = Number(req.params.id);
      const hid = Number(req.params.holding_id);

      const row = db
        .select({ holding: holdings })
        .from(holdings)
        .innerJoin(portfolios, eq(holdings.portfolio_id, portfolios.id))
        .where(
          and(
            eq(holdings.id, hid),
            eq(holdings.portfolio_id, pid),
            eq(portfolios.user_id, user.id),
          ),
        )
        .get();
      if (!row) return reply.code(404).send({ detail: 'Holding not found' });

      db.delete(holdings).where(eq(holdings.id, hid)).run();
      return reply.code(204).send();
    },
  );

  // ── Transactions ──────────────────────────────────────────────────────────
  app.post<{
    Params: { id: string; holding_id: string };
    Body: {
      type: 'buy' | 'sell';
      amount: number;
      price_usd: number;
      note?: string | null;
    };
  }>(
    '/api/portfolios/:id/holdings/:holding_id/transactions',
    async (req, reply) => {
      const user = await getCurrentUser();
      const pid = Number(req.params.id);
      const hid = Number(req.params.holding_id);

      const row = db
        .select({ holding: holdings })
        .from(holdings)
        .innerJoin(portfolios, eq(holdings.portfolio_id, portfolios.id))
        .where(
          and(
            eq(holdings.id, hid),
            eq(holdings.portfolio_id, pid),
            eq(portfolios.user_id, user.id),
          ),
        )
        .get();
      if (!row) return reply.code(404).send({ detail: 'Holding not found' });

      const body = req.body ?? ({} as typeof req.body);
      if (!['buy', 'sell'].includes(body.type)) {
        return reply.code(422).send({ detail: "type must be 'buy' or 'sell'" });
      }
      if (!(body.amount > 0)) {
        return reply.code(422).send({ detail: 'amount must be > 0' });
      }
      if (!(body.price_usd >= 0)) {
        return reply.code(422).send({ detail: 'price_usd must be >= 0' });
      }

      const tx = db
        .insert(transactions)
        .values({
          holding_id: hid,
          type: body.type,
          amount: String(body.amount),
          price_usd: String(body.price_usd),
          note: body.note ?? null,
        })
        .returning()
        .get();

      return reply.code(201).send(tx);
    },
  );

  app.get<{ Params: { id: string; holding_id: string } }>(
    '/api/portfolios/:id/holdings/:holding_id/transactions',
    async (req, reply) => {
      const user = await getCurrentUser();
      const pid = Number(req.params.id);
      const hid = Number(req.params.holding_id);

      const row = db
        .select({ holding: holdings })
        .from(holdings)
        .innerJoin(portfolios, eq(holdings.portfolio_id, portfolios.id))
        .where(
          and(
            eq(holdings.id, hid),
            eq(holdings.portfolio_id, pid),
            eq(portfolios.user_id, user.id),
          ),
        )
        .get();
      if (!row) return reply.code(404).send({ detail: 'Holding not found' });

      return db
        .select()
        .from(transactions)
        .where(eq(transactions.holding_id, hid))
        .orderBy(desc(transactions.timestamp))
        .all();
    },
  );
}
