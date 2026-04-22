import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  webSocket,
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
  rpcUrls: {
    default: { http: [cfg.MONAD_RPC_URL], webSocket: cfg.MONAD_WS_URL ? [cfg.MONAD_WS_URL] : [] },
  },
  blockExplorers: {
    default: { name: 'MonadExplorer', url: cfg.MONAD_EXPLORER },
  },
});

export const publicClient: PublicClient = createPublicClient({
  chain: monad,
  transport: cfg.MONAD_WS_URL ? webSocket(cfg.MONAD_WS_URL) : http(cfg.MONAD_RPC_URL),
});

export const httpClient: PublicClient = createPublicClient({
  chain: monad,
  transport: http(cfg.MONAD_RPC_URL),
});

export function getWallet(): { client: WalletClient; address: Address } {
  if (!cfg.WALLET_PRIVATE_KEY) {
    throw new Error('WALLET_PRIVATE_KEY is required for this operation');
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
