const RPC = 'https://api.mainnet-beta.solana.com';
const MIN_CHANGE = 1e-9;

const KNOWN_MINTS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
  So11111111111111111111111111111111111111112: 'wSOL',
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: 'BONK',
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: 'JUP',
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': 'RAY',
  orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE: 'ORCA',
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: 'mSOL',
  '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj': 'stSOL',
  HZ1JovNiVvGrGs7igeECtKiGHCFwHd9YTFGMCdFMkiuQ: 'PYTH',
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': 'wETH',
  '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E': 'wBTC',
  MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac: 'MNGO',
};

const STABLECOINS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
]);

const ROUTERS: Record<string, string> = {
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: 'Jupiter',
  JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB: 'Jupiter v4',
  JUP3c2Uh3WA4Ng34tw6kPd2G4XKbb5zvxLd4m1K9yXa: 'Jupiter v3',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM',
  '5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h': 'Raydium CLMM',
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: 'Raydium CAMM',
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP': 'Orca',
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: 'Orca Whirlpools',
  srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX: 'OpenBook',
  opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb: 'OpenBook v2',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'Pump.fun',
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: 'Meteora DLMM',
  Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EkAW7vA: 'Meteora',
  PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY: 'Phoenix',
  DEXYosS6oEGvk8uCDayvwEZz4qEyDJRf9nFgYCaqPMTm: 'Dex.guru',
  HKx5d1sMEmBaT17a1r5tCqKw95JZt7M1LRJvkxvfFaV4: 'OKX DEX',
  '6MLxLqofvEkLnefa3cR6jR4H7qCVHXxU1WuwwCzBbfZq': 'OKX DEX',
  obriQD1zbpyLz95G5n7nJe6a4DPjpFwa5XYPoNm113y: 'OKX DEX',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function shorten(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function symbol(mint: string): string {
  return KNOWN_MINTS[mint] ?? shorten(mint);
}

function fmtAmount(amount: number): string {
  const s = amount.toLocaleString('en-US', {
    minimumFractionDigits: 9,
    maximumFractionDigits: 9,
  });
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

function detectRouter(accountKeys: Array<{ pubkey?: string }>): string | null {
  for (const key of accountKeys) {
    const pk = key.pubkey ?? '';
    if (pk in ROUTERS) return ROUTERS[pk]!;
  }
  return null;
}

// ── Parser ─────────────────────────────────────────────────────────────────

interface TokenBalance {
  accountIndex: number;
  owner?: string;
  mint: string;
  uiTokenAmount?: { uiAmount?: number | null };
}

export interface TxSummary {
  chain: 'Solana';
  status: 'success' | 'failed';
  block_time: number | null;
  from_addr: string;
  from_addr_short: string;
  to_addr: string;
  to_addr_short: string;
  value: string | null;
  fee_sol: string;
  payer: string;
  payer_short: string;
  router: string | null;
  fee_display: string | null;
}

function parseSummary(tx: any): TxSummary | null {
  try {
    const meta = tx.meta ?? {};
    const msg = tx.transaction.message;
    const keys: Array<{ pubkey: string; signer?: boolean }> = msg.accountKeys;

    const payer = keys[0]!.pubkey;
    const fee = (meta.fee ?? 0) / 1e9;

    const preBals: number[] = meta.preBalances ?? [];
    const postBals: number[] = meta.postBalances ?? [];
    let solSent = 0;
    let solReceived = 0;
    if (preBals.length && postBals.length) {
      const netSol = (postBals[0]! - preBals[0]!) / 1e9 + fee;
      if (netSol < -MIN_CHANGE) solSent = Math.abs(netSol);
      else if (netSol > MIN_CHANGE) solReceived = netSol;
    }

    const preTok = new Map<number, TokenBalance>();
    for (const e of (meta.preTokenBalances ?? []) as TokenBalance[]) preTok.set(e.accountIndex, e);
    const postTok = new Map<number, TokenBalance>();
    for (const e of (meta.postTokenBalances ?? []) as TokenBalance[]) postTok.set(e.accountIndex, e);
    const allIdx = new Set<number>([...preTok.keys(), ...postTok.keys()]);

    type TokenChange = { mint: string; symbol: string; amount: number };

    const tokenChangesFor = (actor: string): [TokenChange[], TokenChange[]] => {
      const sent: TokenChange[] = [];
      const recv: TokenChange[] = [];
      for (const i of allIdx) {
        const pe = preTok.get(i);
        const po = postTok.get(i);
        const ref = po ?? pe;
        if (!ref || ref.owner !== actor) continue;
        const mint = ref.mint;
        const preA = Number(pe?.uiTokenAmount?.uiAmount ?? 0) || 0;
        const postA = Number(po?.uiTokenAmount?.uiAmount ?? 0) || 0;
        const delta = postA - preA;
        const sym = symbol(mint);
        if (delta < -MIN_CHANGE) sent.push({ mint, symbol: sym, amount: Math.abs(delta) });
        else if (delta > MIN_CHANGE) recv.push({ mint, symbol: sym, amount: delta });
      }
      return [sent, recv];
    };

    let [sentItems, receivedItems] = tokenChangesFor(payer);
    let actor = payer;
    if (sentItems.length === 0 && receivedItems.length === 0) {
      for (const key of keys.slice(1)) {
        if (!key.signer) continue;
        const [s, r] = tokenChangesFor(key.pubkey);
        if (s.length || r.length) {
          sentItems = s;
          receivedItems = r;
          actor = key.pubkey;
          break;
        }
      }
    }

    const router = detectRouter(keys);

    // Fee detection
    let feeDisplay: string | null = null;
    if (receivedItems.length) {
      const recvMint = receivedItems[0]!.mint;
      const recvAmount = receivedItems[0]!.amount;
      let feeGained = 0;
      for (const idx of allIdx) {
        const pe = preTok.get(idx);
        const po = postTok.get(idx);
        const ref = po ?? pe;
        const owner = ref?.owner;
        if (!owner || owner === actor) continue;
        const mint = ref?.mint ?? '';
        if (mint !== recvMint) continue;
        const preAmt = Number(pe?.uiTokenAmount?.uiAmount ?? 0) || 0;
        const postAmt = Number(po?.uiTokenAmount?.uiAmount ?? 0) || 0;
        const delta = postAmt - preAmt;
        if (delta > MIN_CHANGE) feeGained += delta;
      }
      if (feeGained > MIN_CHANGE) {
        const total = recvAmount + feeGained;
        const feePct = total > 0 ? (feeGained / total) * 100 : null;
        const recvSym = receivedItems[0]!.symbol;
        const feeStr = STABLECOINS.has(recvMint)
          ? `$${feeGained.toFixed(2)}`
          : `${fmtAmount(feeGained)} ${recvSym}`;
        feeDisplay = feePct !== null ? `${feeStr} (${feePct.toFixed(2)}%)` : feeStr;
      }
    }

    // "To" address: first non-actor account with a net token gain
    let toAddr = actor;
    for (const idx of allIdx) {
      const pe = preTok.get(idx);
      const po = postTok.get(idx);
      const ref = po ?? pe;
      const owner = ref?.owner;
      if (!owner || owner === actor) continue;
      const preA = Number(pe?.uiTokenAmount?.uiAmount ?? 0) || 0;
      const postA = Number(po?.uiTokenAmount?.uiAmount ?? 0) || 0;
      if (postA - preA > MIN_CHANGE) {
        toAddr = owner;
        break;
      }
    }

    let sentPart: string | null = null;
    let recvPart: string | null = null;
    if (sentItems.length) {
      const it = sentItems[0]!;
      sentPart = `${fmtAmount(it.amount)} ${it.symbol}`;
    } else if (solSent > MIN_CHANGE) {
      sentPart = `${fmtAmount(solSent)} SOL`;
    }
    if (receivedItems.length) {
      const it = receivedItems[0]!;
      recvPart = `${fmtAmount(it.amount)} ${it.symbol}`;
    } else if (solReceived > MIN_CHANGE) {
      recvPart = `${fmtAmount(solReceived)} SOL`;
    }

    const valueStr =
      sentPart && recvPart
        ? `${sentPart} → ${recvPart}`
        : sentPart ?? recvPart ?? null;

    return {
      chain: 'Solana',
      status: meta.err ? 'failed' : 'success',
      block_time: tx.blockTime ?? null,
      from_addr: actor,
      from_addr_short: shorten(actor),
      to_addr: toAddr,
      to_addr_short: shorten(toAddr),
      value: valueStr,
      fee_sol: `${fmtAmount(fee)} SOL`,
      payer,
      payer_short: shorten(payer),
      router,
      fee_display: feeDisplay,
    };
  } catch {
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function fetchTxSummary(signature: string): Promise<TxSummary | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [
          signature,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
        ],
      }),
    });
    const data = (await resp.json()) as { result?: unknown };
    if (!data.result) return null;
    return parseSummary(data.result);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
