import { settings } from './config.ts';

const BASE = settings.etherscan_base_url;
const CONCURRENCY = 5; // Etherscan free tier: 5 req/sec

export const ETH_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

export interface WalletBalance {
  contract_address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: number;
}

// ── Tiny semaphore ──────────────────────────────────────────────────────────

class Semaphore {
  private waiters: Array<() => void> = [];
  constructor(private slots: number) {}
  async acquire(): Promise<() => void> {
    if (this.slots > 0) {
      this.slots -= 1;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.slots -= 1;
        resolve(() => this.release());
      });
    });
  }
  private release() {
    this.slots += 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

// ── Low-level GET ───────────────────────────────────────────────────────────

async function etherscanGet<T = any>(
  sem: Semaphore,
  params: Record<string, string | number>,
): Promise<T> {
  const release = await sem.acquire();
  try {
    const full = new URLSearchParams({
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      chainid: '1',
      ...(settings.etherscan_api_key ? { apikey: settings.etherscan_api_key } : {}),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const resp = await fetch(`${BASE}?${full.toString()}`, {
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`Etherscan ${resp.status}`);
      return (await resp.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  } finally {
    release();
  }
}

// ── Individual calls ────────────────────────────────────────────────────────

async function fetchEthBalance(sem: Semaphore, address: string): Promise<number> {
  const data = await etherscanGet<{ status: string; result: string }>(sem, {
    module: 'account',
    action: 'balance',
    address,
    tag: 'latest',
  });
  if (data.status === '1') return Number(BigInt(data.result)) / 1e18;
  return 0;
}

interface TokenContract {
  contract_address: string;
  symbol: string;
  name: string;
  decimals: number;
}

async function fetchTokenContracts(
  sem: Semaphore,
  address: string,
): Promise<TokenContract[]> {
  const data = await etherscanGet<{
    status: string;
    result: Array<{
      contractAddress: string;
      tokenSymbol?: string;
      tokenName?: string;
      tokenDecimal?: string;
    }>;
  }>(sem, {
    module: 'account',
    action: 'tokentx',
    address,
    startblock: 0,
    endblock: 99999999,
    sort: 'desc',
    page: 1,
    offset: 1000,
  });

  if (data.status !== '1' || !Array.isArray(data.result)) return [];

  const seen = new Map<string, TokenContract>();
  for (const tx of data.result) {
    const ca = tx.contractAddress.toLowerCase();
    if (!seen.has(ca)) {
      seen.set(ca, {
        contract_address: ca,
        symbol: tx.tokenSymbol ?? '',
        name: tx.tokenName ?? '',
        decimals: Number.parseInt(tx.tokenDecimal ?? '18', 10) || 18,
      });
    }
  }
  return [...seen.values()];
}

async function fetchTokenBalance(
  sem: Semaphore,
  address: string,
  contract: TokenContract,
): Promise<WalletBalance | null> {
  try {
    const data = await etherscanGet<{ status: string; result: string }>(sem, {
      module: 'account',
      action: 'tokenbalance',
      contractaddress: contract.contract_address,
      address,
      tag: 'latest',
    });
    if (data.status !== '1') return null;
    const raw = BigInt(data.result);
    const divisor = 10n ** BigInt(contract.decimals);
    // Preserve precision: do integer + fractional parts separately.
    const intPart = Number(raw / divisor);
    const fracPart = Number(raw % divisor) / Number(divisor);
    const balance = intPart + fracPart;
    if (balance > 0) return { ...contract, balance };
    return null;
  } catch {
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function fetchWalletBalances(
  address: string,
): Promise<WalletBalance[]> {
  const sem = new Semaphore(CONCURRENCY);

  const [ethBalance, contracts] = await Promise.all([
    fetchEthBalance(sem, address),
    fetchTokenContracts(sem, address),
  ]);

  const tokenResults = await Promise.all(
    contracts.map((c) => fetchTokenBalance(sem, address, c)),
  );

  const balances: WalletBalance[] = [];
  if (ethBalance > 0) {
    balances.push({
      contract_address: ETH_SENTINEL,
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      balance: ethBalance,
    });
  }
  for (const r of tokenResults) if (r) balances.push(r);
  return balances;
}
