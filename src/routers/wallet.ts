import type { FastifyInstance } from 'fastify';

import {
  fetchPrices,
  matchTokensByContract,
  type ContractMatch,
} from '../coingecko.ts';
import {
  fetchWalletBalances,
  ETH_SENTINEL,
  type WalletBalance,
} from '../etherscan.ts';

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

interface WalletToken {
  coingecko_id: string | null;
  contract_address: string;
  name: string;
  symbol: string;
  amount: number;
  current_price_usd: number | null;
  image_url: string | null;
  matched: boolean;
}

export async function walletRouter(app: FastifyInstance) {
  app.get<{ Params: { address: string } }>(
    '/api/wallet/eth/:address',
    async (req, reply) => {
      const { address } = req.params;
      if (!ETH_ADDRESS_RE.test(address)) {
        return reply.code(422).send({ detail: 'Invalid Ethereum address format' });
      }

      let balances: WalletBalance[];
      try {
        balances = await fetchWalletBalances(address);
      } catch (err) {
        app.log.warn({ err }, 'Etherscan error');
        return reply.code(502).send({ detail: `Etherscan error: ${String(err)}` });
      }

      if (balances.length === 0) return [];

      const ethEntry = balances.find((b) => b.contract_address === ETH_SENTINEL);
      const erc20Entries = balances.filter((b) => b.contract_address !== ETH_SENTINEL);

      const [ethPrices, contractMap] = await Promise.all([
        ethEntry ? fetchPrices(['ethereum']) : Promise.resolve({}),
        matchTokensByContract(erc20Entries.map((e) => e.contract_address)),
      ]);

      const tokens: WalletToken[] = [];

      if (ethEntry) {
        const eth = ethPrices['ethereum'];
        tokens.push({
          coingecko_id: 'ethereum',
          contract_address: ETH_SENTINEL,
          name: 'Ethereum',
          symbol: 'ETH',
          amount: ethEntry.balance,
          current_price_usd: eth?.current_price_usd ?? null,
          image_url: eth?.image_url ?? null,
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
    },
  );
}
