import type { FastifyInstance, FastifyReply } from 'fastify';

import { settings } from '../config.ts';
import {
  fetchBalances,
  fetchMarkets,
  fetchTicker,
  paxosGet,
} from '../paxos.ts';

function checkConfigured(reply: FastifyReply): true | undefined {
  if (!settings.paxos_client_id || !settings.paxos_client_secret) {
    reply.code(503).send({ detail: 'Paxos API credentials not configured' });
    return;
  }
  return true;
}

export async function paxosRouter(app: FastifyInstance) {
  app.get('/api/paxos/debug', async (_req, reply) => {
    if (!checkConfigured(reply)) return;
    const results: Record<string, unknown> = { base_url: settings.paxos_base_url };
    for (const path of ['/identity/profiles', '/profiles', '/markets']) {
      try {
        results[path] = await paxosGet(path);
      } catch (err) {
        const e = err as { status?: number; message?: string };
        results[path] = { error: e.status ?? String(err), message: e.message ?? '' };
      }
    }
    return results;
  });

  app.get('/api/paxos/balances', async (_req, reply) => {
    if (!checkConfigured(reply)) return;
    if (!settings.paxos_profile_id) {
      return reply.code(503).send({ detail: 'PAXOS_PROFILE_ID not configured' });
    }
    try {
      return await fetchBalances(settings.paxos_profile_id);
    } catch (err) {
      app.log.error({ err }, 'Paxos balances failed');
      return reply.code(502).send({ detail: `Failed to fetch Paxos balances: ${String(err)}` });
    }
  });

  app.get('/api/paxos/markets', async (_req, reply) => {
    if (!checkConfigured(reply)) return;
    try {
      return await fetchMarkets();
    } catch (err) {
      app.log.error({ err }, 'Paxos markets failed');
      return reply.code(502).send({ detail: 'Failed to fetch Paxos markets' });
    }
  });

  app.get<{ Querystring: { market?: string } }>('/api/paxos/ticker', async (req, reply) => {
    if (!checkConfigured(reply)) return;
    const market = (req.query.market ?? '').trim().toUpperCase();
    if (!market || market.length > 20) {
      return reply.code(422).send({ detail: 'market required (1-20 chars)' });
    }
    try {
      return await fetchTicker(market);
    } catch (err) {
      app.log.error({ err, market }, 'Paxos ticker failed');
      return reply.code(502).send({ detail: 'Failed to fetch Paxos ticker' });
    }
  });

  app.get('/api/paxos/prices', async (_req, reply) => {
    if (!checkConfigured(reply)) return;
    try {
      const markets = await fetchMarkets();
      const usdPairs = markets
        .filter((m: any) => m?.quote_asset === 'USD')
        .map((m: any) => m.market as string);

      const settled = await Promise.allSettled(usdPairs.map((m) => fetchTicker(m)));
      const results: any[] = [];
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          results.push({ ...r.value, market: usdPairs[i] });
        }
      });
      return results;
    } catch (err) {
      app.log.error({ err }, 'Paxos prices failed');
      return reply.code(502).send({ detail: 'Failed to fetch Paxos prices' });
    }
  });
}
