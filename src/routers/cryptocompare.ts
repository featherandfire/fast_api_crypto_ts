import type { FastifyInstance } from 'fastify';

import { fetchPctChanges, fetchVolatilities } from '../cryptocompare.ts';

function parseList(v: string | undefined, cap: number): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, cap);
}

function parseDays(v: string | undefined, cap = 5): number[] {
  return parseList(v, cap)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export async function cryptocompareRouter(app: FastifyInstance) {
  app.get<{ Querystring: { symbols?: string; days?: string } }>(
    '/api/cryptocompare/changes',
    async (req, reply) => {
      const symbols = parseList(req.query.symbols, 50);
      if (!symbols.length) return reply.code(422).send({ detail: 'symbols required' });
      const days = parseDays(req.query.days ?? '548');
      return fetchPctChanges(symbols, days);
    },
  );

  app.get<{ Querystring: { symbols?: string; days?: string } }>(
    '/api/cryptocompare/volatility',
    async (req, reply) => {
      const symbols = parseList(req.query.symbols, 200);
      if (!symbols.length) return reply.code(422).send({ detail: 'symbols required' });
      const days = parseDays(req.query.days ?? '90,180');
      return fetchVolatilities(symbols, days);
    },
  );
}
