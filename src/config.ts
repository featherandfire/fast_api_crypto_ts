import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  return v ? Number.parseInt(v, 10) : fallback;
}

export const settings = {
  secret_key: required('SECRET_KEY'),
  database_url: optional('DATABASE_URL', './crypto_portfolio_ts.db'),
  access_token_expire_minutes: int('ACCESS_TOKEN_EXPIRE_MINUTES', 60),
  algorithm: optional('ALGORITHM', 'HS256'),

  coingecko_base_url: optional('COINGECKO_BASE_URL', 'https://api.coingecko.com/api/v3'),

  etherscan_api_key: optional('ETHERSCAN_API_KEY'),
  etherscan_base_url: optional('ETHERSCAN_BASE_URL', 'https://api.etherscan.io/v2/api'),

  paxos_client_id: optional('PAXOS_CLIENT_ID'),
  paxos_client_secret: optional('PAXOS_CLIENT_SECRET'),
  paxos_profile_id: optional('PAXOS_PROFILE_ID'),
  paxos_base_url: optional('PAXOS_BASE_URL', 'https://api.sandbox.paxos.com/v2'),
  paxos_oauth_url: optional('PAXOS_OAUTH_URL', 'https://oauth.sandbox.paxos.com/oauth2/token'),

  cryptocompare_api_key: optional('CRYPTOCOMPARE_API_KEY'),
  cryptocompare_base_url: optional('CRYPTOCOMPARE_BASE_URL', 'https://min-api.cryptocompare.com'),
} as const;
