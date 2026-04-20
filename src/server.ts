import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';

import { db } from './db/client.ts';
import { users } from './db/schema.ts';
import { startYearlyPrefetch } from './coingecko.ts';
import { startBackgroundPrefetch as startCCPrefetch } from './cryptocompare.ts';
import { authRouter } from './routers/auth.ts';
import { coinsRouter } from './routers/coins.ts';
import { cryptocompareRouter } from './routers/cryptocompare.ts';
import { lookupRouter } from './routers/lookup.ts';
import { portfolioRouter } from './routers/portfolio.ts';
import { walletRouter } from './routers/wallet.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Frontend assets now live inside this project (moved in from the retired
// Python app). Templates are still Jinja-style {% include %} partials, which
// we flatten into a single HTML per request (see renderIndex below).
const PROJECT_ROOT = resolve(__dirname, '..');
const STATIC_DIR = resolve(PROJECT_ROOT, 'static');
const TEMPLATES_DIR = resolve(PROJECT_ROOT, 'templates');

function renderIndex(): string {
  const entry = readFileSync(resolve(TEMPLATES_DIR, 'index.html'), 'utf-8');
  // Replace {% include "partials/..." %} with the file contents. Templates
  // carry no variables, so a single pass suffices.
  return entry.replace(/\{%\s*include\s+"([^"]+)"\s*%\}/g, (_, rel) =>
    readFileSync(resolve(TEMPLATES_DIR, rel), 'utf-8'),
  );
}

const app = Fastify({ logger: true });

await app.register(fastifyStatic, {
  root: STATIC_DIR,
  prefix: '/static/',
});

await app.register(authRouter);
await app.register(portfolioRouter);
await app.register(coinsRouter);
await app.register(walletRouter);
await app.register(cryptocompareRouter);
await app.register(lookupRouter);

startCCPrefetch();
startYearlyPrefetch();

// SPA catch-all — any non-/static, non-/api path returns index.html.
// Rendered per-request so edits to the Jinja partials pick up without a
// server restart (they live outside src/ so tsx watch doesn't see them).
app.get('/*', async (req, reply) => {
  if (req.url.startsWith('/static') || req.url.startsWith('/api')) {
    return reply.code(404).send({ detail: 'Not Found' });
  }
  reply.type('text/html').send(renderIndex());
});

const PORT = Number(process.env.PORT ?? 8000);

// Smoke check: confirm DB connection and report row count.
const userCount = db.select({ c: sql<number>`count(*)` }).from(users).get();
app.log.info(`DB connected — users: ${userCount?.c ?? 0}`);

await app.listen({ host: '127.0.0.1', port: PORT });
