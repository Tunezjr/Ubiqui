import { parseAbiItem, type Address } from 'viem';
import { pairAbi } from './abis.js';
import { publicClient } from './chain.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';

const cfg = loadConfig();

const pairCreatedEvent = parseAbiItem(
  'event PairCreated(address indexed token0, address indexed token1, address pair, uint256)',
);

export type NewPair = {
  block: bigint;
  pair: Address;
  token: Address;
  reserveMon: bigint;
  reserveToken: bigint;
};

async function inspectPair(
  pair: Address,
  token0: Address,
  token1: Address,
  block: bigint,
): Promise<NewPair | null> {
  try {
    const [r0, r1] = (await publicClient.readContract({
      address: pair,
      abi: pairAbi,
      functionName: 'getReserves',
    })) as [bigint, bigint, number];

    const wmon = cfg.WMON_ADDRESS.toLowerCase();
    const isWmon0 = token0.toLowerCase() === wmon;
    const isWmon1 = token1.toLowerCase() === wmon;
    if (!isWmon0 && !isWmon1) return null;

    return {
      block,
      pair,
      token: (isWmon0 ? token1 : token0) as Address,
      reserveMon: isWmon0 ? r0 : r1,
      reserveToken: isWmon0 ? r1 : r0,
    };
  } catch (err) {
    logger.warn('inspectPair failed', { pair, err: String(err) });
    return null;
  }
}

export async function fetchNewPairs(fromBlock: bigint, toBlock: bigint): Promise<NewPair[]> {
  const logs = await publicClient.getLogs({
    address: cfg.FACTORY_ADDRESS,
    event: pairCreatedEvent,
    fromBlock,
    toBlock,
  });
  const out: NewPair[] = [];
  for (const log of logs) {
    const { token0, token1, pair } = log.args as {
      token0: Address;
      token1: Address;
      pair: Address;
    };
    const info = await inspectPair(pair, token0, token1, log.blockNumber ?? toBlock);
    if (!info) continue;
    if (info.reserveMon < BigInt(Math.floor(cfg.MIN_LIQUIDITY_MON * 1e18))) continue;
    out.push(info);
  }
  return out;
}
