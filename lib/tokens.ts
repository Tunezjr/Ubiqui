import type { Address, PublicClient } from 'viem';
import { erc20Abi } from './abis.js';

export type TokenMetadata = {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
};

const cache = new Map<Address, TokenMetadata>();

export async function getTokenMetadata(
  client: PublicClient,
  address: Address,
): Promise<TokenMetadata> {
  const cached = cache.get(address);
  if (cached) return cached;

  const [name, symbol, decimals] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: 'name' }).catch(() => 'unknown'),
    client.readContract({ address, abi: erc20Abi, functionName: 'symbol' }).catch(() => '???'),
    client.readContract({ address, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18),
  ]);

  const meta: TokenMetadata = {
    address,
    name: name as string,
    symbol: symbol as string,
    decimals: Number(decimals),
  };
  cache.set(address, meta);
  return meta;
}

export async function getBalance(
  client: PublicClient,
  token: Address,
  owner: Address,
): Promise<bigint> {
  return (await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner],
  })) as bigint;
}
