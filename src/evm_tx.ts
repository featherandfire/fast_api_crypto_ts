// EVM tx parser — finds the most recent "buy" of a target token for a wallet
// and returns the fee breakdown in the same shape as the Solana equivalent.
// Uses Etherscan V2 multichain API for history + receipt, and CoinGecko for
// the native-token USD price.

import { settings } from './config.ts';
import { CHAINS, type ChainInfo } from './etherscan.ts';
import { fetchPrices } from './coingecko.ts';
import type { LastBuyFees, FeeParty } from './solana_rpc.ts';

const BASE = settings.etherscan_base_url;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Common router contracts on EVM chains. Keys are lowercase addresses.
const ROUTERS: Record<string, string> = {
  // Uniswap
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': 'Uniswap V2 Router',
  '0xe592427a0aece92de3edee1f18e0157c05861564': 'Uniswap V3 Router',
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': 'Uniswap V3 Router 2',
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': 'Universal Router',
  // 1inch
  '0x1111111254eeb25477b68fb85ed929f73a960582': '1inch AggregationRouter V5',
  '0x111111125421ca6dc452d289314280a0f8842a65': '1inch AggregationRouter V6',
  // Paraswap
  '0x6a000f20005980200259b80c5102003040001068': 'ParaSwap V6',
  '0xdef171fe48cf0115b1d80b88dc8eab59176fee57': 'ParaSwap V5',
  // 0x / Matcha
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff': '0x Protocol',
  // Sushiswap
  '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f': 'SushiSwap Router',
  // CoW Swap
  '0x9008d19f58aabd9ed0d60971565aa8510560ab41': 'CoW Protocol',
  // Binance
  '0x10ed43c718714eb63d5aa57b78b54704e256024e': 'PancakeSwap V2 Router',
};

// Known per-coin common contracts — used for lightweight price resolution.
// (We only need ETH/native token prices for gas USD conversion.)

async function etherscanGet<T = any>(
  chainId: number,
  params: Record<string, string | number>,
): Promise<T> {
  const full = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    chainid: String(chainId),
    ...(settings.etherscan_api_key ? { apikey: settings.etherscan_api_key } : {}),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const resp = await fetch(`${BASE}?${full.toString()}`, { signal: controller.signal });
    if (!resp.ok) throw new Error(`Etherscan ${resp.status}`);
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface TokenTxEntry {
  hash: string;
  from: string;
  to: string;
  value: string;
  contractAddress: string;
  tokenSymbol: string;
  tokenName: string;
  tokenDecimal: string;
  timeStamp: string;
}

async function fetchLastIncomingTokenTx(
  chain: ChainInfo,
  wallet: string,
  contract: string,
): Promise<TokenTxEntry | null> {
  const data = await etherscanGet<{ status: string; result: TokenTxEntry[] }>(chain.chainId, {
    module: 'account',
    action: 'tokentx',
    address: wallet,
    contractaddress: contract,
    sort: 'desc',
    page: 1,
    offset: 20,
  });
  if (data.status !== '1' || !Array.isArray(data.result)) return null;
  const walletLower = wallet.toLowerCase();
  return data.result.find((t) => t.to.toLowerCase() === walletLower) ?? null;
}

interface TxRaw {
  hash: string;
  from: string;
  to: string;
  gasPrice: string;
  value: string;
}

interface TxReceipt {
  gasUsed: string;
  effectiveGasPrice?: string;
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
  }>;
}

async function rpcCall<T = any>(rpcUrl: string, method: string, params: unknown[]): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const data = (await resp.json()) as { result?: T };
    return data.result ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function hexToBigInt(h: string): bigint {
  if (!h || h === '0x') return 0n;
  return BigInt(h);
}

function addrFromTopic(topic: string): string {
  // Address is last 20 bytes of the 32-byte topic.
  return ('0x' + topic.slice(-40)).toLowerCase();
}

interface TransferLog {
  token: string;       // ERC-20 contract (lowercase)
  from: string;
  to: string;
  amount: bigint;
}

function parseTransferLogs(logs: TxReceipt['logs']): TransferLog[] {
  const out: TransferLog[] = [];
  for (const log of logs) {
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    if (log.topics.length < 3) continue;
    out.push({
      token: log.address.toLowerCase(),
      from: addrFromTopic(log.topics[1]!),
      to: addrFromTopic(log.topics[2]!),
      amount: hexToBigInt(log.data),
    });
  }
  return out;
}

export async function fetchEvmLastBuyFees(
  chainSlug: string,
  wallet: string,
  contract: string,
): Promise<LastBuyFees | null> {
  const chain = CHAINS[chainSlug];
  if (!chain) return null;

  const walletLower = wallet.toLowerCase();
  const contractLower = contract.toLowerCase();

  // 1. Find the most recent incoming transfer of the target token to the wallet.
  const txEntry = await fetchLastIncomingTokenTx(chain, wallet, contract);
  if (!txEntry) return null;

  // 2. Fetch the full tx + receipt via this chain's RPC.
  const [tx, receipt] = await Promise.all([
    rpcCall<TxRaw>(chain.rpcUrl, 'eth_getTransactionByHash', [txEntry.hash]),
    rpcCall<TxReceipt>(chain.rpcUrl, 'eth_getTransactionReceipt', [txEntry.hash]),
  ]);
  if (!tx || !receipt) return null;

  const transfers = parseTransferLogs(receipt.logs ?? []);

  // 3. Wallet's net position per token from the logs.
  type TokenDelta = { token: string; in: bigint; out: bigint };
  const byToken = new Map<string, TokenDelta>();
  for (const t of transfers) {
    if (t.from !== walletLower && t.to !== walletLower) continue;
    const entry = byToken.get(t.token) ?? { token: t.token, in: 0n, out: 0n };
    if (t.to === walletLower) entry.in += t.amount;
    if (t.from === walletLower) entry.out += t.amount;
    byToken.set(t.token, entry);
  }

  // 4. Decimals come from Etherscan's tokentx for the target token; other
  //    tokens we see may not be in the response. For a minimal-accuracy MVP,
  //    we fall back to 18 decimals when unknown.
  const targetDecimals = Number.parseInt(txEntry.tokenDecimal || '18', 10);

  // 5. Received = target token inflow to wallet.
  const targetDelta = byToken.get(contractLower);
  const receivedAmount =
    targetDelta ? Number(targetDelta.in) / 10 ** targetDecimals : 0;

  // 6. Sent = the wallet's largest outflow (could be ETH or another ERC-20).
  //    Native ETH transfer shows in tx.value, not logs.
  let sentSymbol = chain.nativeSymbol;
  let sentAmount = 0;
  let sentContract: string | null = null;
  const nativeValue = Number(hexToBigInt(tx.value)) / 1e18;
  if (nativeValue > 0 && tx.from.toLowerCase() === walletLower) {
    sentAmount = nativeValue;
  } else {
    // Largest ERC-20 outflow from the wallet.
    let maxOut: { token: string; amount: bigint } | null = null;
    for (const d of byToken.values()) {
      if (d.token === contractLower) continue;
      if (d.out > 0n && (!maxOut || d.out > maxOut.amount)) {
        maxOut = { token: d.token, amount: d.out };
      }
    }
    if (maxOut) {
      sentSymbol = 'TOKEN'; // we don't have symbol/decimals for arbitrary ERC-20
      sentAmount = Number(maxOut.amount) / 1e18;
      sentContract = maxOut.token;
    }
  }

  // 7. Fee parties — non-wallet addresses that gained any of the involved
  //    tokens, excluding the swap counterparty (>20% of sent amount).
  const partyTotals = new Map<string, { amount: bigint; token: string }>();
  for (const t of transfers) {
    if (t.to === walletLower) continue;
    if (t.from === walletLower) continue; // wallet's own outflows don't count as fees received
    // Only interesting if this token is either sent or received mint
    const relevant =
      t.token === contractLower ||
      (sentContract && t.token === sentContract);
    if (!relevant) continue;
    const key = `${t.to}:${t.token}`;
    const existing = partyTotals.get(key);
    if (existing) existing.amount += t.amount;
    else partyTotals.set(key, { amount: t.amount, token: t.token });
  }

  const fee_parties: FeeParty[] = [];
  for (const [key, { amount, token }] of partyTotals) {
    const owner = key.split(':')[0]!;
    const amountFloat = Number(amount) / 10 ** (token === contractLower ? targetDecimals : 18);
    // Filter counterparties (received close to full sent amount).
    if (sentContract && token === sentContract && amountFloat > sentAmount * 0.2) continue;
    fee_parties.push({
      address_short: `${owner.slice(0, 6)}…${owner.slice(-4)}`,
      amount: amountFloat,
      symbol: token === contractLower ? txEntry.tokenSymbol : 'TOKEN',
      mint: token,
      is_stable: false,
    });
  }
  fee_parties.sort((a, b) => b.amount - a.amount);

  // 8. Network gas fee in native → USD.
  const gasUsed = hexToBigInt(receipt.gasUsed);
  const gasPrice = hexToBigInt(receipt.effectiveGasPrice ?? tx.gasPrice);
  const gasNative = Number(gasUsed * gasPrice) / 1e18;
  let gasUsd: number | null = null;
  try {
    const priceMap = await fetchPrices([chain.nativeCgId]);
    const nativeUsd = priceMap[chain.nativeCgId]?.current_price_usd ?? null;
    if (nativeUsd != null) gasUsd = gasNative * nativeUsd;
  } catch {
    // leave gasUsd null
  }
  const fee_sol =
    gasUsd != null
      ? `${gasNative.toFixed(6)} ${chain.nativeSymbol} ($${gasUsd.toFixed(4)})`
      : `${gasNative.toFixed(6)} ${chain.nativeSymbol}`;

  // 9. Router = tx.to if it's in our known-routers map.
  const toLower = tx.to?.toLowerCase() ?? '';
  const routerName = ROUTERS[toLower] ?? null;
  const routers = routerName ? [routerName] : [];

  // 10. fee_pct = explicit fees in sent mint / sent amount.
  let fee_pct: number | null = null;
  if (sentContract && sentAmount > 0) {
    const feeInSent = fee_parties
      .filter((p) => p.mint === sentContract)
      .reduce((s, p) => s + p.amount, 0);
    fee_pct = (feeInSent / sentAmount) * 100;
  }

  return {
    signature: txEntry.hash,
    block_time: Number.parseInt(txEntry.timeStamp, 10) || null,
    router: routerName,
    routers,
    fee_sol,
    fee_display: null,
    sent: sentAmount > 0 ? `${sentAmount.toFixed(6)} ${sentSymbol}` : null,
    received: receivedAmount > 0 ? `${receivedAmount} ${txEntry.tokenSymbol}` : null,
    fee_parties,
    spread_usd: null,   // would need reference prices on both sides
    fee_pct,
  };
}
