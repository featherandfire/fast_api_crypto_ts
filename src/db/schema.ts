import {
  sqliteTable,
  integer,
  text,
  real,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

// Mirror of app/models.py. Numeric columns are stored as TEXT in SQLite by
// the Python app (SQLAlchemy Numeric) — we read them as text and parse as
// needed at the call site.

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username', { length: 50 }).notNull().unique(),
  email: text('email', { length: 255 }).notNull().unique(),
  hashed_password: text('hashed_password', { length: 255 }).notNull(),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  is_verified: integer('is_verified', { mode: 'boolean' })
    .notNull()
    .default(false),
  verification_code: text('verification_code', { length: 6 }),
  verification_expires: text('verification_expires'),
});

export const portfolios = sqliteTable(
  'portfolios',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name', { length: 100 }).notNull(),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    uq_user_name: uniqueIndex('uq_portfolio_user_name').on(t.user_id, t.name),
  }),
);

export const coins = sqliteTable('coins', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  coingecko_id: text('coingecko_id', { length: 100 }).notNull().unique(),
  symbol: text('symbol', { length: 20 }).notNull(),
  name: text('name', { length: 100 }).notNull(),
  current_price_usd: text('current_price_usd'),
  price_change_24h: text('price_change_24h'),
  market_cap: text('market_cap'),
  image_url: text('image_url', { length: 500 }),
  last_updated: text('last_updated'),
  circulating_supply: text('circulating_supply'),
  max_supply: text('max_supply'),
});

export const holdings = sqliteTable(
  'holdings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    portfolio_id: integer('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    coin_id: integer('coin_id')
      .notNull()
      .references(() => coins.id, { onDelete: 'cascade' }),
    wallet_address: text('wallet_address'),
    amount: text('amount').notNull().default('0'),
    avg_buy_price: text('avg_buy_price'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    uq_portfolio_coin_wallet: uniqueIndex(
      'uq_holding_portfolio_coin_wallet',
    ).on(t.portfolio_id, t.coin_id, t.wallet_address),
  }),
);

export const transactions = sqliteTable('transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  holding_id: integer('holding_id')
    .notNull()
    .references(() => holdings.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['buy', 'sell'] }).notNull(),
  amount: text('amount').notNull(),
  price_usd: text('price_usd').notNull(),
  timestamp: text('timestamp').default(sql`CURRENT_TIMESTAMP`),
  note: text('note', { length: 500 }),
});

// ── Relations (for Drizzle relational queries) ───────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  portfolios: many(portfolios),
}));

export const portfoliosRelations = relations(portfolios, ({ one, many }) => ({
  owner: one(users, { fields: [portfolios.user_id], references: [users.id] }),
  holdings: many(holdings),
}));

export const coinsRelations = relations(coins, ({ many }) => ({
  holdings: many(holdings),
}));

export const holdingsRelations = relations(holdings, ({ one, many }) => ({
  portfolio: one(portfolios, {
    fields: [holdings.portfolio_id],
    references: [portfolios.id],
  }),
  coin: one(coins, { fields: [holdings.coin_id], references: [coins.id] }),
  transactions: many(transactions),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  holding: one(holdings, {
    fields: [transactions.holding_id],
    references: [holdings.id],
  }),
}));
