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
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',  // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',  // USDT
  'CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH',  // Phantom CASH (USD-pegged)
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
  proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u: 'Phantom Swap',
  ALPHAQmeA7bjrVuccPsYPiCvsi428SNwte66Srvs4pHA: 'AlphaQ',
  '6m2CDdhRgxpH4WjvdzxAYbGxwdGUz5MziiL5jek2kBma': 'OKX DEX Aggregator',
  Ag3hiK9svNixH9Vu5sD2CmK5fyDWrx9a1iVSbZW22bUS: 'OKX Labs',
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

function detectRouters(accountKeys: Array<{ pubkey?: string }>): string[] {
  const seen = new Set<string>();
  for (const key of accountKeys) {
    const pk = key.pubkey ?? '';
    if (pk in ROUTERS) seen.add(ROUTERS[pk]!);
  }
  return [...seen];
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

// ── Last-buy fee lookup ─────────────────────────────────────────────────────

export interface FeeParty {
  address_short: string;
  amount: number;
  symbol: string;
  mint: string;
  is_stable: boolean;
}

export interface LastBuyFees {
  signature: string;
  block_time: number | null;
  router: string | null;        // primary router (first detected)
  routers: string[];            // every DEX / aggregator program involved
  fee_sol: string;              // network fee as display string
  fee_display: string | null;   // router/platform fee skim ("0.12 USDC (2.4%)")
  sent: string | null;          // e.g. "0.05 SOL"
  received: string | null;      // e.g. "4.77 USDC"
  fee_parties: FeeParty[];      // every non-actor account that gained tokens
  // Implicit spread cost (DEX Routing + LP combined), when it can be
  // computed — only available when both sent and received are stablecoins
  // since then both sides have a known $1 peg. null otherwise.
  spread_usd: number | null;
  // Explicit fees as % of the input amount (fee_parties in the sent mint
  // divided by sent amount × 100). Null if no input flow detected.
  fee_pct: number | null;
}

// Find the most recent transaction where `walletAddress` received `mint` and
// return its fee breakdown. Returns null if nothing matching found in the
// last `limit` signatures.
export async function fetchLastBuyFees(
  walletAddress: string,
  mint: string,
  limit = 30,
): Promise<LastBuyFees | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let sigs: Array<{ signature: string; blockTime?: number }>;
  try {
    const resp = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [walletAddress, { limit }],
      }),
    });
    const data = (await resp.json()) as { result?: Array<{ signature: string; blockTime?: number }> };
    sigs = data.result ?? [];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  for (const { signature, blockTime } of sigs) {
    // Fetch the raw tx, not just the summary, so we can match on structured
    // received-item mints rather than symbol strings.
    const raw = await fetchRawTx(signature);
    if (!raw) continue;

    const parsed = _parseStructured(raw, walletAddress);
    if (!parsed) continue;

    const receivedMint = parsed.received?.mint;
    if (receivedMint !== mint) continue;

    // If both sides of the swap are stablecoins (both pegged $1), any gap
    // between input and output beyond the explicit fees is the implicit
    // spread — what OKX/LP actually took via the exchange rate.
    let spread_usd: number | null = null;
    if (
      parsed.sent &&
      parsed.received &&
      STABLECOINS.has(parsed.sent.mint) &&
      STABLECOINS.has(parsed.received.mint)
    ) {
      const explicitInInputMint = parsed.fee_parties
        .filter((p) => p.mint === parsed.sent!.mint)
        .reduce((s, p) => s + p.amount, 0);
      const reachedPool = parsed.sent.amount - explicitInInputMint;
      spread_usd = Math.max(0, reachedPool - parsed.received.amount);
    }

    // Explicit fee percentage of the input amount.
    let fee_pct: number | null = null;
    if (parsed.sent && parsed.sent.amount > 0) {
      const feesInInputMint = parsed.fee_parties
        .filter((p) => p.mint === parsed.sent!.mint)
        .reduce((s, p) => s + p.amount, 0);
      fee_pct = (feesInInputMint / parsed.sent.amount) * 100;
    }

    return {
      signature,
      block_time: blockTime ?? raw.blockTime ?? null,
      router: parsed.router,
      routers: parsed.routers,
      fee_sol: parsed.fee_sol,
      fee_display: parsed.fee_display,
      sent: parsed.sent
        ? `${fmtAmount(parsed.sent.amount)} ${parsed.sent.symbol}`
        : null,
      received: parsed.received
        ? `${fmtAmount(parsed.received.amount)} ${parsed.received.symbol}`
        : null,
      fee_parties: parsed.fee_parties,
      spread_usd,
      fee_pct,
    };
  }

  return null;
}

async function fetchRawTx(signature: string): Promise<any | null> {
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
        params: [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
      }),
    });
    const data = (await resp.json()) as { result?: any };
    return data.result ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface StructuredSummary {
  router: string | null;
  routers: string[];
  fee_sol: string;
  fee_display: string | null;
  sent: { mint: string; symbol: string; amount: number } | null;
  received: { mint: string; symbol: string; amount: number } | null;
  fee_parties: FeeParty[];
}

function _parseStructured(tx: any, wallet: string): StructuredSummary | null {
  try {
    const meta = tx.meta ?? {};
    const msg = tx.transaction.message;
    const keys: Array<{ pubkey: string; signer?: boolean }> = msg.accountKeys;
    const fee = (meta.fee ?? 0) / 1e9;

    const preTok = new Map<number, TokenBalance>();
    for (const e of (meta.preTokenBalances ?? []) as TokenBalance[]) preTok.set(e.accountIndex, e);
    const postTok = new Map<number, TokenBalance>();
    for (const e of (meta.postTokenBalances ?? []) as TokenBalance[]) postTok.set(e.accountIndex, e);
    const allIdx = new Set<number>([...preTok.keys(), ...postTok.keys()]);
    const preBals: number[] = meta.preBalances ?? [];
    const postBals: number[] = meta.postBalances ?? [];

    type TokenChange = { mint: string; symbol: string; amount: number };

    // Flows for a given owner (either wallet or fallback signer).
    const flowsFor = (owner: string) => {
      const sent: TokenChange[] = [];
      const recv: TokenChange[] = [];
      for (const i of allIdx) {
        const pe = preTok.get(i);
        const po = postTok.get(i);
        const ref = po ?? pe;
        if (!ref || ref.owner !== owner) continue;
        const preA = Number(pe?.uiTokenAmount?.uiAmount ?? 0) || 0;
        const postA = Number(po?.uiTokenAmount?.uiAmount ?? 0) || 0;
        const delta = postA - preA;
        if (delta < -MIN_CHANGE) sent.push({ mint: ref.mint, symbol: symbol(ref.mint), amount: Math.abs(delta) });
        else if (delta > MIN_CHANGE) recv.push({ mint: ref.mint, symbol: symbol(ref.mint), amount: delta });
      }
      // Native SOL leg
      const idx = keys.findIndex((k) => k.pubkey === owner);
      if (idx >= 0 && preBals[idx] != null && postBals[idx] != null) {
        const netSol = (postBals[idx]! - preBals[idx]!) / 1e9 + (idx === 0 ? fee : 0);
        if (netSol < -MIN_CHANGE) sent.push({ mint: 'SOL', symbol: 'SOL', amount: Math.abs(netSol) });
        else if (netSol > MIN_CHANGE) recv.push({ mint: 'SOL', symbol: 'SOL', amount: netSol });
      }
      return { sent, recv };
    };

    // Actors = wallet + every signer. Anything credited to an address
    // outside this set on a relevant mint is a fee collector.
    const actors = new Set<string>([wallet]);
    for (const k of keys) if (k.signer) actors.add(k.pubkey);

    // Aggregate outflows/inflows across every actor so we pick up the CASH
    // leg even when Phantom delegates signing to a different wallet.
    const allSent: TokenChange[] = [];
    const receivedFlows: TokenChange[] = flowsFor(wallet).recv;
    for (const a of actors) {
      const f = flowsFor(a);
      for (const s of f.sent) allSent.push(s);
    }
    // Collapse duplicates — if multiple actors have the same mint outflow,
    // keep the largest (represents the real swap input, not dust).
    const sentByMint = new Map<string, TokenChange>();
    for (const s of allSent) {
      const existing = sentByMint.get(s.mint);
      if (!existing || s.amount > existing.amount) sentByMint.set(s.mint, s);
    }
    // Prefer non-SOL outflow since SOL is usually just network/rent dust.
    const sortedSent = [...sentByMint.values()].sort((a, b) => {
      if (a.mint === 'SOL' && b.mint !== 'SOL') return 1;
      if (b.mint === 'SOL' && a.mint !== 'SOL') return -1;
      return b.amount - a.amount;
    });
    const sentFlows: TokenChange[] = sortedSent;

    if (receivedFlows.length === 0) return null;

    // Mints of interest: what the wallet received + what any actor sent.
    const receivedMint = receivedFlows[0]!.mint;
    const mintsOfInterest = new Set<string>([receivedMint]);
    for (const s of sentFlows) mintsOfInterest.add(s.mint);

    // Aggregate fees per (owner, mint) across all non-actor accounts that
    // gained a token in one of the mints of interest.
    const partyTotals = new Map<string, { amount: number; mint: string }>();
    for (const i of allIdx) {
      const pe = preTok.get(i);
      const po = postTok.get(i);
      const ref = po ?? pe;
      const owner = ref?.owner;
      if (!owner || actors.has(owner)) continue;
      const mint = ref?.mint ?? '';
      if (!mintsOfInterest.has(mint)) continue;
      const preAmt = Number(pe?.uiTokenAmount?.uiAmount ?? 0) || 0;
      const postAmt = Number(po?.uiTokenAmount?.uiAmount ?? 0) || 0;
      const delta = postAmt - preAmt;
      if (delta <= MIN_CHANGE) continue;
      const key = `${owner}:${mint}`;
      const existing = partyTotals.get(key);
      if (existing) existing.amount += delta;
      else partyTotals.set(key, { amount: delta, mint });
    }

    // Separate fee collectors from swap counterparties: if an address
    // received close to the full sent amount in that mint, it's the pool /
    // DEX counterparty, not a fee. Threshold: <= 20% of sent = fee.
    const fee_parties: FeeParty[] = [];
    for (const [key, { amount, mint }] of partyTotals) {
      const owner = key.split(':')[0]!;
      const sentSameMint = sentFlows.find((s) => s.mint === mint);
      if (sentSameMint && amount > sentSameMint.amount * 0.2) continue; // counterparty
      fee_parties.push({
        address_short: `${owner.slice(0, 4)}…${owner.slice(-4)}`,
        amount,
        symbol: symbol(mint),
        mint,
        is_stable: STABLECOINS.has(mint),
      });
    }
    fee_parties.sort((a, b) => b.amount - a.amount);

    // Legacy single-line fee display — first non-actor party for the
    // received mint, kept for the Hash Lookup UI.
    let feeDisplay: string | null = null;
    let feeGained = 0;
    for (const p of fee_parties) {
      if (p.mint === receivedMint) feeGained += p.amount;
    }
    if (feeGained > MIN_CHANGE) {
      const total = receivedFlows[0]!.amount + feeGained;
      const feePct = total > 0 ? (feeGained / total) * 100 : null;
      const sym = receivedFlows[0]!.symbol;
      const feeStr = STABLECOINS.has(receivedMint)
        ? `$${feeGained.toFixed(2)}`
        : `${fmtAmount(feeGained)} ${sym}`;
      feeDisplay = feePct !== null ? `${feeStr} (${feePct.toFixed(2)}%)` : feeStr;
    }

    const routers = detectRouters(keys);
    return {
      router: routers[0] ?? null,
      routers,
      fee_sol: `${fmtAmount(fee)} SOL`,
      fee_display: feeDisplay,
      sent: sentFlows[0] ?? null,
      received: receivedFlows[0] ?? null,
      fee_parties,
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
