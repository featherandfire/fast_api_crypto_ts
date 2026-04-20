// Solana wallet balance fetcher — native SOL + SPL (standard and Token-2022).

const RPC = 'https://api.mainnet-beta.solana.com';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export const SOL_NATIVE_SENTINEL = 'native-sol';

export interface SolanaBalance {
  mint: string;        // SOL_NATIVE_SENTINEL for native SOL, else SPL mint address
  symbol: string;      // best-effort — caller should refine via CoinGecko
  name: string;
  decimals: number;
  balance: number;
}

async function rpc<T = any>(method: string, params: unknown[]): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const resp = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!resp.ok) throw new Error(`Solana RPC ${resp.status}`);
    const data = (await resp.json()) as { result?: T; error?: { message?: string } };
    if (data.error) throw new Error(`Solana RPC: ${data.error.message ?? 'unknown error'}`);
    return data.result as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSolBalance(address: string): Promise<number> {
  try {
    const res = await rpc<{ value?: number }>('getBalance', [address]);
    return (res.value ?? 0) / 1e9;
  } catch {
    return 0;
  }
}

interface SplAccount {
  account: {
    data: {
      parsed: {
        info: {
          mint: string;
          owner: string;
          tokenAmount: { amount: string; decimals: number; uiAmount: number | null };
        };
      };
    };
  };
}

async function fetchSplAccounts(address: string, programId: string): Promise<SplAccount[]> {
  try {
    const res = await rpc<{ value?: SplAccount[] }>('getTokenAccountsByOwner', [
      address,
      { programId },
      { encoding: 'jsonParsed' },
    ]);
    return res.value ?? [];
  } catch {
    return [];
  }
}

function shortenMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

export async function fetchSolanaWalletBalances(
  address: string,
): Promise<SolanaBalance[]> {
  const [solBalance, splStandard, spl2022] = await Promise.all([
    fetchSolBalance(address),
    fetchSplAccounts(address, TOKEN_PROGRAM),
    fetchSplAccounts(address, TOKEN_2022_PROGRAM),
  ]);

  const balances: SolanaBalance[] = [];

  if (solBalance > 0) {
    balances.push({
      mint: SOL_NATIVE_SENTINEL,
      symbol: 'SOL',
      name: 'Solana',
      decimals: 9,
      balance: solBalance,
    });
  }

  // Aggregate by mint — a wallet can hold multiple token accounts for the same mint.
  const byMint = new Map<string, SolanaBalance>();
  for (const account of [...splStandard, ...spl2022]) {
    const info = account.account?.data?.parsed?.info;
    if (!info) continue;
    const amount = info.tokenAmount?.uiAmount ?? 0;
    if (amount <= 0) continue;

    const existing = byMint.get(info.mint);
    if (existing) {
      existing.balance += amount;
    } else {
      byMint.set(info.mint, {
        mint: info.mint,
        symbol: shortenMint(info.mint),
        name: shortenMint(info.mint),
        decimals: info.tokenAmount.decimals,
        balance: amount,
      });
    }
  }

  for (const b of byMint.values()) balances.push(b);
  return balances;
}
