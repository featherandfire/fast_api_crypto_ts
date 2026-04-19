import type { FastifyInstance } from 'fastify';

import { fetchTxSummary, type TxSummary } from '../solana_rpc.ts';

// ── Chain config ────────────────────────────────────────────────────────────

interface EvmChain {
  chain: string;
  chain_name: string;
  color: string;
  rpc_url: string;
  explorer_base: string;
  tx_path: string;
  address_path: string;
  block_path: string;
  probe: boolean;
}

const EVM_CHAINS: EvmChain[] = [
  {
    chain: 'ethereum',
    chain_name: 'Ethereum',
    color: '#627EEA',
    rpc_url: 'https://cloudflare-eth.com',
    explorer_base: 'https://etherscan.io',
    tx_path: '/tx/{hash}',
    address_path: '/address/{hash}',
    block_path: '/block/{hash}',
    probe: true,
  },
  {
    chain: 'bsc',
    chain_name: 'BNB Smart Chain',
    color: '#F3BA2F',
    rpc_url: 'https://bsc-dataseed.binance.org',
    explorer_base: 'https://bscscan.com',
    tx_path: '/tx/{hash}',
    address_path: '/address/{hash}',
    block_path: '/block/{hash}',
    probe: true,
  },
  {
    chain: 'polygon',
    chain_name: 'Polygon',
    color: '#8247E5',
    rpc_url: 'https://polygon-rpc.com',
    explorer_base: 'https://polygonscan.com',
    tx_path: '/tx/{hash}',
    address_path: '/address/{hash}',
    block_path: '/block/{hash}',
    probe: true,
  },
  {
    chain: 'arbitrum',
    chain_name: 'Arbitrum One',
    color: '#28A0F0',
    rpc_url: 'https://arb1.arbitrum.io/rpc',
    explorer_base: 'https://arbiscan.io',
    tx_path: '/tx/{hash}',
    address_path: '/address/{hash}',
    block_path: '/block/{hash}',
    probe: false,
  },
  {
    chain: 'optimism',
    chain_name: 'Optimism',
    color: '#FF0420',
    rpc_url: 'https://mainnet.optimism.io',
    explorer_base: 'https://optimistic.etherscan.io',
    tx_path: '/tx/{hash}',
    address_path: '/address/{hash}',
    block_path: '/block/{hash}',
    probe: false,
  },
  {
    chain: 'avalanche',
    chain_name: 'Avalanche C-Chain',
    color: '#E84142',
    rpc_url: 'https://api.avax.network/ext/bc/C/rpc',
    explorer_base: 'https://snowtrace.io',
    tx_path: '/tx/{hash}',
    address_path: '/address/{hash}',
    block_path: '/block/{hash}',
    probe: false,
  },
  {
    chain: 'base',
    chain_name: 'Base',
    color: '#0052FF',
    rpc_url: 'https://mainnet.base.org',
    explorer_base: 'https://basescan.org',
    tx_path: '/tx/{hash}',
    address_path: '/address/{hash}',
    block_path: '/block/{hash}',
    probe: false,
  },
];

const NON_EVM_CHAINS: Record<string, {
  chain: string;
  chain_name: string;
  color: string;
  explorer_base: string;
  tx_path: string;
  address_path: string;
}> = {
  bitcoin: {
    chain: 'bitcoin',
    chain_name: 'Bitcoin',
    color: '#F7931A',
    explorer_base: 'https://mempool.space',
    tx_path: '/tx/{hash}',
    address_path: '/address/{hash}',
  },
  solana: {
    chain: 'solana',
    chain_name: 'Solana',
    color: '#9945FF',
    explorer_base: 'https://solscan.io',
    tx_path: '/tx/{hash}',
    address_path: '/account/{hash}',
  },
  tron: {
    chain: 'tron',
    chain_name: 'Tron',
    color: '#EF0027',
    explorer_base: 'https://tronscan.org',
    tx_path: '/#/transaction/{hash}',
    address_path: '/#/address/{hash}',
  },
  litecoin: {
    chain: 'litecoin',
    chain_name: 'Litecoin',
    color: '#BFBBBB',
    explorer_base: 'https://blockchair.com/litecoin',
    tx_path: '/transaction/{hash}',
    address_path: '/address/{hash}',
  },
};

// ── Regex ───────────────────────────────────────────────────────────────────

const RE_EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const RE_EVM_TX = /^0x[0-9a-fA-F]{64}$/;
const RE_BTC_LEGACY = /^[13][a-km-zA-HJ-NP-Z1-9]{24,33}$/;
const RE_BTC_BECH32 = /^bc1[a-z0-9]{6,87}$/;
const RE_HEX64 = /^[0-9a-fA-F]{64}$/;
const RE_SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RE_SOL_SIG = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/;
const RE_TRON = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const RE_LTC_LEGACY = /^[LM][a-km-zA-HJ-NP-Z1-9]{25,33}$/;
const RE_LTC_BECH32 = /^ltc1[a-z0-9]{6,87}$/;

// ── Types ───────────────────────────────────────────────────────────────────

type Confidence = 'confirmed' | 'likely' | 'format_only';

interface ChainMatch {
  chain: string;
  chain_name: string;
  color: string;
  explorer_url: string;
  explorer_link: string;
  confidence: Confidence;
}

interface LookupResponse {
  hash: string;
  type: string;
  matches: ChainMatch[];
  summary?: TxSummary;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function link(
  cfg: { explorer_base: string } & Record<string, string>,
  hash: string,
  pathKey: string,
): string {
  return cfg.explorer_base + (cfg[pathKey] as string).replace('{hash}', hash);
}

function evmMatch(
  cfg: EvmChain,
  hash: string,
  pathKey: 'tx_path' | 'address_path' | 'block_path',
  confidence: Confidence,
): ChainMatch {
  return {
    chain: cfg.chain,
    chain_name: cfg.chain_name,
    color: cfg.color,
    explorer_url: cfg.explorer_base,
    explorer_link: link(cfg as any, hash, pathKey),
    confidence,
  };
}

function nonEvmMatch(
  key: keyof typeof NON_EVM_CHAINS,
  hash: string,
  pathKey: 'tx_path' | 'address_path',
  confidence: Confidence,
): ChainMatch {
  const cfg = NON_EVM_CHAINS[key]!;
  return {
    chain: cfg.chain,
    chain_name: cfg.chain_name,
    color: cfg.color,
    explorer_url: cfg.explorer_base,
    explorer_link: link(cfg as any, hash, pathKey),
    confidence,
  };
}

// ── Format detection ────────────────────────────────────────────────────────

function detectHashFormat(h: string): { raw_type: string; display_type: string } {
  const hl = h.toLowerCase();
  if (RE_EVM_ADDRESS.test(h)) return { raw_type: 'evm_address', display_type: 'EVM Address' };
  if (RE_EVM_TX.test(hl)) return { raw_type: 'evm_tx_hash', display_type: 'EVM Transaction / Block Hash' };
  if (RE_TRON.test(h)) return { raw_type: 'tron_address', display_type: 'Tron Address' };
  if (RE_LTC_BECH32.test(hl)) return { raw_type: 'ltc_bech32_address', display_type: 'Litecoin Address (Bech32)' };
  if (RE_LTC_LEGACY.test(h)) return { raw_type: 'ltc_address', display_type: 'Litecoin Address' };
  if (RE_BTC_BECH32.test(hl)) return { raw_type: 'btc_bech32_address', display_type: 'Bitcoin Address (SegWit/Taproot)' };
  if (RE_BTC_LEGACY.test(h)) return { raw_type: 'btc_address', display_type: 'Bitcoin Address' };
  if (RE_SOL_SIG.test(h)) return { raw_type: 'sol_tx_sig', display_type: 'Solana Transaction Signature' };
  if (RE_HEX64.test(hl)) return { raw_type: 'btc_tx_hash', display_type: 'Bitcoin Transaction Hash' };
  if (RE_SOL_ADDRESS.test(h)) return { raw_type: 'sol_address', display_type: 'Solana Address' };
  return { raw_type: 'unknown', display_type: 'Unknown Format' };
}

// ── EVM tx probing ──────────────────────────────────────────────────────────

async function probeOne(chain: EvmChain, hash: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const resp = await fetch(chain.rpc_url, {
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
    const data = (await resp.json()) as { result?: unknown };
    return data.result != null ? chain.chain : null;
  } finally {
    clearTimeout(timer);
  }
}

async function probeEvmChains(hash: string): Promise<{ confirmed: string[]; allFailed: boolean }> {
  const probeChains = EVM_CHAINS.filter((c) => c.probe);
  const results = await Promise.allSettled(
    probeChains.map((c) => probeOne(c, hash)),
  );
  const confirmed: string[] = [];
  let allFailed = true;
  for (const r of results) {
    if (r.status === 'rejected') continue;
    allFailed = false;
    if (r.value !== null) confirmed.push(r.value);
  }
  return { confirmed, allFailed };
}

// ── Router ──────────────────────────────────────────────────────────────────

export async function lookupRouter(app: FastifyInstance) {
  app.get<{ Params: { hash: string } }>('/api/lookup/:hash', async (req, reply) => {
    const h = req.params.hash.trim();
    if (!h) return reply.code(422).send({ detail: 'Empty input' });
    if (h.length > 200) return reply.code(422).send({ detail: 'Input too long' });

    const detection = detectHashFormat(h);
    const { raw_type } = detection;
    const matches: ChainMatch[] = [];
    let summary: TxSummary | undefined;

    if (raw_type === 'unknown') {
      return { hash: h, type: detection.display_type, matches: [] };
    }

    if (raw_type === 'evm_address') {
      for (const cfg of EVM_CHAINS) matches.push(evmMatch(cfg, h, 'address_path', 'format_only'));
    } else if (raw_type === 'evm_tx_hash') {
      const { confirmed, allFailed } = await probeEvmChains(h);
      const confirmedSet = new Set(confirmed);
      if (confirmedSet.size) {
        for (const cfg of EVM_CHAINS) {
          if (confirmedSet.has(cfg.chain)) matches.push(evmMatch(cfg, h, 'tx_path', 'confirmed'));
        }
        for (const cfg of EVM_CHAINS) {
          if (!cfg.probe) matches.push(evmMatch(cfg, h, 'tx_path', 'likely'));
        }
      } else if (allFailed) {
        for (const cfg of EVM_CHAINS) matches.push(evmMatch(cfg, h, 'tx_path', 'format_only'));
      }
    } else if (raw_type === 'btc_address' || raw_type === 'btc_bech32_address') {
      matches.push(nonEvmMatch('bitcoin', h, 'address_path', 'likely'));
    } else if (raw_type === 'btc_tx_hash') {
      matches.push(nonEvmMatch('bitcoin', h, 'tx_path', 'likely'));
    } else if (raw_type === 'sol_address') {
      matches.push(nonEvmMatch('solana', h, 'address_path', 'likely'));
    } else if (raw_type === 'sol_tx_sig') {
      matches.push(nonEvmMatch('solana', h, 'tx_path', 'likely'));
      const rawSummary = await fetchTxSummary(h);
      if (rawSummary) summary = rawSummary;
    } else if (raw_type === 'tron_address') {
      matches.push(nonEvmMatch('tron', h, 'address_path', 'likely'));
    } else if (raw_type === 'ltc_address' || raw_type === 'ltc_bech32_address') {
      matches.push(nonEvmMatch('litecoin', h, 'address_path', 'likely'));
    }

    const response: LookupResponse = { hash: h, type: detection.display_type, matches };
    if (summary) response.summary = summary;
    return response;
  });
}
