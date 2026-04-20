import type { FastifyInstance } from 'fastify';

import {
  fetchPrices,
  matchTokensByContract,
  type ContractMatch,
  type PriceRecord,
} from '../coingecko.ts';
import {
  fetchWalletBalances,
  ETH_SENTINEL,
  CHAINS,
  type WalletBalance,
} from '../etherscan.ts';
import {
  fetchSolanaWalletBalances,
  SOL_NATIVE_SENTINEL,
} from '../solana_wallet.ts';
import { fetchTxSummary, fetchLastBuyFees } from '../solana_rpc.ts';
import { fetchEvmLastBuyFees } from '../evm_tx.ts';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { coins } from '../db/schema.ts';
import { resolveContractAddress } from '../coingecko.ts';

// Inverse of the SOLANA_MINT_FALLBACKS in coingecko.ts — lets us resolve
// a CoinGecko id back to the SPL mint address so frontend can request
// last-buy fees for holdings it knows by CG id.
const CG_TO_SOL_MINT: Record<string, string> = {
  'usd-coin': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  tether: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'wrapped-solana': 'So11111111111111111111111111111111111111112',
  bonk: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'jupiter-exchange-solana': 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  raydium: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  orca: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  msol: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  'pyth-network': 'HZ1JovNiVvGrGs7igeECtKiGHCFwHd9YTFGMCdFMkiuQ',
};

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
// Base58, 32-44 chars (Solana public keys)
const SOL_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// EVM tx / block hash: 0x + 64 hex
const EVM_TX_RE = /^0x[0-9a-fA-F]{64}$/;
// Solana tx signature: 87-88 base58 chars
const SOL_SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/;

interface WalletToken {
  coingecko_id: string | null;
  contract_address: string;
  chain: string;          // slug: eth, bsc, polygon, ...
  chain_name: string;     // display name
  name: string;
  symbol: string;
  amount: number;
  current_price_usd: number | null;
  image_url: string | null;
  matched: boolean;
}

// Per-chain resolver, used by both the single-chain and all-chains endpoints.
async function getWalletTokensForChain(
  chainSlug: string,
  address: string,
): Promise<WalletToken[]> {
  const chainInfo = CHAINS[chainSlug];
  if (!chainInfo) return [];

  const balances: WalletBalance[] = await fetchWalletBalances(address, chainSlug);
  if (balances.length === 0) return [];

  const nativeEntry = balances.find((b) => b.contract_address === ETH_SENTINEL);
  const erc20Entries = balances.filter((b) => b.contract_address !== ETH_SENTINEL);

  const [nativePrices, contractMap] = await Promise.all([
    nativeEntry
      ? fetchPrices([chainInfo.nativeCgId])
      : Promise.resolve({} as Record<string, PriceRecord>),
    matchTokensByContract(
      erc20Entries.map((e) => e.contract_address),
      chainInfo.cgPlatform,
    ),
  ]);

  const tokens: WalletToken[] = [];

  if (nativeEntry) {
    const native = nativePrices[chainInfo.nativeCgId];
    tokens.push({
      coingecko_id: chainInfo.nativeCgId,
      contract_address: ETH_SENTINEL,
      chain: chainSlug,
      chain_name: chainInfo.name,
      name: chainInfo.nativeName,
      symbol: chainInfo.nativeSymbol,
      amount: nativeEntry.balance,
      current_price_usd: native?.current_price_usd ?? null,
      image_url: native?.image_url ?? null,
      matched: true,
    });
  }

  const matched: WalletToken[] = [];
  const unmatched: WalletToken[] = [];
  for (const entry of erc20Entries) {
    const info: ContractMatch | undefined = contractMap[entry.contract_address];
    const token: WalletToken = {
      coingecko_id: info?.coingecko_id ?? null,
      contract_address: entry.contract_address,
      chain: chainSlug,
      chain_name: chainInfo.name,
      name: info?.name ?? entry.name,
      symbol: info?.symbol ?? entry.symbol,
      amount: entry.balance,
      current_price_usd: info?.current_price_usd ?? null,
      image_url: info?.image_url ?? null,
      matched: Boolean(info),
    };
    (info ? matched : unmatched).push(token);
  }

  return [...tokens, ...matched, ...unmatched];
}

// Solana resolver — parallel structure to getWalletTokensForChain.
async function getSolanaWalletTokens(address: string): Promise<WalletToken[]> {
  const balances = await fetchSolanaWalletBalances(address);
  if (balances.length === 0) return [];

  const nativeEntry = balances.find((b) => b.mint === SOL_NATIVE_SENTINEL);
  const splEntries = balances.filter((b) => b.mint !== SOL_NATIVE_SENTINEL);

  // Active Solana wallets routinely hold hundreds of dust/airdrop tokens.
  // Looking up every mint against CoinGecko would grind for minutes and
  // trip rate limits, so only match the top-N by balance; everything else
  // is returned as unmatched (user can still import them with no price).
  const MATCH_CAP = 50;
  const byBalanceDesc = [...splEntries].sort((a, b) => b.balance - a.balance);
  const splToMatch = byBalanceDesc.slice(0, MATCH_CAP);

  // Race the CG matching against a hard wall-clock timeout so one slow pass
  // can't hang the whole request.
  const matchWithTimeout = Promise.race([
    matchTokensByContract(splToMatch.map((e) => e.mint), 'solana'),
    new Promise<Record<string, ContractMatch>>((resolve) =>
      setTimeout(() => resolve({}), 10_000),
    ),
  ]);

  const [nativePrices, contractMap] = await Promise.all([
    nativeEntry
      ? fetchPrices(['solana'])
      : Promise.resolve({} as Record<string, PriceRecord>),
    matchWithTimeout,
  ]);

  const tokens: WalletToken[] = [];

  if (nativeEntry) {
    const native = nativePrices['solana'];
    tokens.push({
      coingecko_id: 'solana',
      contract_address: SOL_NATIVE_SENTINEL,
      chain: 'solana',
      chain_name: 'Solana',
      name: 'Solana',
      symbol: 'SOL',
      amount: nativeEntry.balance,
      current_price_usd: native?.current_price_usd ?? null,
      image_url: native?.image_url ?? null,
      matched: true,
    });
  }

  const matched: WalletToken[] = [];
  const unmatched: WalletToken[] = [];
  for (const entry of splEntries) {
    const info: ContractMatch | undefined = contractMap[entry.mint];
    const token: WalletToken = {
      coingecko_id: info?.coingecko_id ?? null,
      contract_address: entry.mint,
      chain: 'solana',
      chain_name: 'Solana',
      name: info?.name ?? entry.name,
      symbol: info?.symbol ?? entry.symbol,
      amount: entry.balance,
      current_price_usd: info?.current_price_usd ?? null,
      image_url: info?.image_url ?? null,
      matched: Boolean(info),
    };
    (info ? matched : unmatched).push(token);
  }

  // Cap the returned list so dust/airdrop-heavy wallets don't overwhelm the
  // UI. Matched tokens are always kept; unmatched are truncated by balance.
  const MAX_UNMATCHED = 100 - matched.length;
  const unmatchedTopByBalance = unmatched
    .sort((a, b) => b.amount - a.amount)
    .slice(0, Math.max(0, MAX_UNMATCHED));

  return [...tokens, ...matched, ...unmatchedTopByBalance];
}

// Probe one EVM chain for a tx hash and return the `from` address if found.
async function evmTxFrom(rpcUrl: string, hash: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionByHash',
        params: [hash],
      }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { result?: { from?: string } };
    return data.result?.from ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function walletRouter(app: FastifyInstance) {
  // Resolve a tx hash / signature to the originating wallet address.
  app.get<{ Params: { hash: string } }>(
    '/api/wallet/from-tx/:hash',
    async (req, reply) => {
      const hash = req.params.hash.trim();

      // Solana tx signature — fetch via RPC and return payer.
      if (SOL_SIG_RE.test(hash)) {
        const summary = await fetchTxSummary(hash);
        if (!summary?.payer) {
          return reply.code(404).send({ detail: 'Solana transaction not found' });
        }
        return {
          address: summary.payer,
          chain: 'solana',
          chain_name: 'Solana',
        };
      }

      // EVM tx hash — probe every supported chain in parallel.
      if (EVM_TX_RE.test(hash)) {
        const probes = await Promise.all(
          Object.entries(CHAINS).map(async ([slug, info]) => ({
            slug,
            name: info.name,
            from: await evmTxFrom(info.rpcUrl, hash),
          })),
        );
        const hit = probes.find((p) => p.from);
        if (!hit || !hit.from) {
          return reply
            .code(404)
            .send({ detail: 'Transaction not found on any supported EVM chain' });
        }
        return { address: hit.from, chain: hit.slug, chain_name: hit.name };
      }

      return reply
        .code(422)
        .send({ detail: 'Unsupported transaction hash format' });
    },
  );

  app.get('/api/wallet/chains', async () => {
    return Object.entries(CHAINS).map(([slug, info]) => ({
      slug,
      name: info.name,
      native_symbol: info.nativeSymbol,
    }));
  });

  // Auto-probe all supported chains (EVM + Solana) based on address format.
  app.get<{ Params: { address: string } }>(
    '/api/wallet/all/:address',
    async (req, reply) => {
      const { address } = req.params;

      if (EVM_ADDRESS_RE.test(address)) {
        const results = await Promise.allSettled(
          Object.keys(CHAINS).map((slug) => getWalletTokensForChain(slug, address)),
        );
        const all: WalletToken[] = [];
        for (const r of results) {
          if (r.status === 'fulfilled') all.push(...r.value);
        }
        return all;
      }

      if (SOL_ADDRESS_RE.test(address)) {
        try {
          return await getSolanaWalletTokens(address);
        } catch (err) {
          app.log.warn({ err }, 'Solana RPC error');
          return reply.code(502).send({ detail: `Solana RPC error: ${String(err)}` });
        }
      }

      return reply
        .code(422)
        .send({ detail: 'Invalid address format (expected EVM 0x… or Solana base58)' });
    },
  );

  // Last-buy fees for an EVM holding. Resolves the coin's contract_address
  // from the coins table, then scans Etherscan for the most recent receive
  // tx of that token and parses the tx receipt for fees.
  app.get<{
    Params: { chain: string; address: string };
    Querystring: { coingecko_id?: string; contract_address?: string };
  }>('/api/wallet/:chain/:address/last-buy-fees', async (req, reply) => {
    const { chain, address } = req.params;
    if (!CHAINS[chain]) {
      return reply.code(404).send({ detail: `Unsupported chain: ${chain}` });
    }
    if (!EVM_ADDRESS_RE.test(address)) {
      return reply.code(422).send({ detail: 'Invalid EVM address' });
    }

    let contract = req.query.contract_address ?? null;
    const coingeckoId = req.query.coingecko_id;

    if (!contract && coingeckoId) {
      const row = db
        .select({ contract_address: coins.contract_address })
        .from(coins)
        .where(eq(coins.coingecko_id, coingeckoId))
        .get();
      contract = row?.contract_address ?? null;

      // Backfill via CoinGecko for coins imported before we tracked
      // contract_address, then persist so next lookups are instant.
      if (!contract) {
        contract = await resolveContractAddress(coingeckoId, CHAINS[chain]!.cgPlatform);
        if (contract) {
          db.update(coins)
            .set({ contract_address: contract })
            .where(eq(coins.coingecko_id, coingeckoId))
            .run();
        }
      }
    }

    if (!contract) {
      return reply
        .code(404)
        .send({ detail: 'No contract_address known for this coin' });
    }

    const fees = await fetchEvmLastBuyFees(chain, address, contract);
    if (!fees) {
      return reply.code(404).send({ detail: 'No recent buy found' });
    }
    return fees;
  });

  // Last-buy fees for a specific Solana holding. Accepts the CoinGecko id
  // (as held in the coins table) and resolves it to the SPL mint via our
  // known-mint table, then scans the wallet's recent tx history.
  app.get<{
    Params: { address: string };
    Querystring: { coingecko_id?: string; mint?: string };
  }>('/api/wallet/solana/:address/last-buy-fees', async (req, reply) => {
    const { address } = req.params;
    if (!SOL_ADDRESS_RE.test(address)) {
      return reply.code(422).send({ detail: 'Invalid Solana address' });
    }
    const { coingecko_id, mint: mintQuery } = req.query;
    const mint = mintQuery ?? (coingecko_id ? CG_TO_SOL_MINT[coingecko_id] : undefined);
    if (!mint) {
      return reply
        .code(404)
        .send({ detail: 'Unknown SPL mint — cannot resolve fees for this holding' });
    }
    const fees = await fetchLastBuyFees(address, mint);
    if (!fees) {
      return reply.code(404).send({ detail: 'No recent buy found' });
    }
    return fees;
  });

  // Dedicated Solana endpoint for callers that already know the chain.
  app.get<{ Params: { address: string } }>(
    '/api/wallet/solana/:address',
    async (req, reply) => {
      const { address } = req.params;
      if (!SOL_ADDRESS_RE.test(address)) {
        return reply.code(422).send({ detail: 'Invalid Solana address format' });
      }
      try {
        return await getSolanaWalletTokens(address);
      } catch (err) {
        app.log.warn({ err }, 'Solana RPC error');
        return reply.code(502).send({ detail: `Solana RPC error: ${String(err)}` });
      }
    },
  );

  // Single-chain endpoint kept for callers that want to target one network.
  app.get<{ Params: { chain: string; address: string } }>(
    '/api/wallet/:chain/:address',
    async (req, reply) => {
      const { chain, address } = req.params;
      if (!CHAINS[chain]) {
        return reply.code(404).send({ detail: `Unsupported chain: ${chain}` });
      }
      if (!EVM_ADDRESS_RE.test(address)) {
        return reply.code(422).send({ detail: 'Invalid EVM address format' });
      }

      try {
        return await getWalletTokensForChain(chain, address);
      } catch (err) {
        app.log.warn({ err, chain }, 'Etherscan error');
        return reply.code(502).send({ detail: `Etherscan error: ${String(err)}` });
      }
    },
  );
}
