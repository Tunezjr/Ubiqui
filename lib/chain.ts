import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadConfig } from './config.js';

const cfg = loadConfig();

export const monad = defineChain({
  id: cfg.MONAD_CHAIN_ID,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [cfg.MONAD_RPC_URL] } },
  blockExplorers: { default: { name: 'MonadExplorer', url: cfg.MONAD_EXPLORER } },
});

export const publicClient: PublicClient = createPublicClient({
  chain: monad,
  transport: http(cfg.MONAD_RPC_URL, { timeout: 15_000 }),
});

export function getWallet(): { client: WalletClient; address: Address } {
  if (!cfg.WALLET_PRIVATE_KEY) {
    throw new Error('WALLET_PRIVATE_KEY is required');
  }
  const account = privateKeyToAccount(cfg.WALLET_PRIVATE_KEY as Hex);
  const client = createWalletClient({
    account,
    chain: monad,
    transport: http(cfg.MONAD_RPC_URL),
  });
  return { client, address: account.address };
}

export function explorerTx(hash: Hex): string {
  return `${cfg.MONAD_EXPLORER}/tx/${hash}`;
}

export function explorerAddr(address: Address): string {
  return `${cfg.MONAD_EXPLORER}/address/${address}`;
}
