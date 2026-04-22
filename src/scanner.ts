import { formatEther, parseAbiItem, type Address, type Log } from 'viem';
import { factoryAbi, pairAbi } from './abis.js';
import { publicClient } from './chain.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { getTokenMetadata } from './tokens.js';

const cfg = loadConfig();

const pairCreatedEvent = parseAbiItem(
  'event PairCreated(address indexed token0, address indexed token1, address pair, uint256)',
);

export type NewPair = {
  pair: Address;
  token: Address;
  token0: Address;
  token1: Address;
  reserveMon: bigint;
  reserveToken: bigint;
};

async function inspectPair(pair: Address, token0: Address, token1: Address): Promise<NewPair | null> {
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
    pair,
    token: (isWmon0 ? token1 : token0) as Address,
    token0,
    token1,
    reserveMon: isWmon0 ? r0 : r1,
    reserveToken: isWmon0 ? r1 : r0,
  };
}

export function onNewPair(handler: (pair: NewPair) => void | Promise<void>): () => void {
  logger.info({ factory: cfg.FACTORY_ADDRESS }, 'watching PairCreated events');
  const unwatch = publicClient.watchEvent({
    address: cfg.FACTORY_ADDRESS,
    event: pairCreatedEvent,
    onLogs: async (logs: Log[]) => {
      for (const raw of logs) {
        const log = raw as unknown as {
          args: { token0: Address; token1: Address; pair: Address };
        };
        const { token0, token1, pair } = log.args;
        try {
          const info = await inspectPair(pair, token0, token1);
          if (!info) {
            logger.debug({ pair }, 'ignoring non-WMON pair');
            continue;
          }
          if (info.reserveMon < BigInt(Math.floor(cfg.MIN_LIQUIDITY_MON * 1e18))) {
            logger.debug(
              { pair: info.pair, liquidity: formatEther(info.reserveMon) },
              'pair below minimum liquidity',
            );
            continue;
          }
          const meta = await getTokenMetadata(publicClient, info.token);
          logger.info(
            {
              pair: info.pair,
              token: info.token,
              symbol: meta.symbol,
              liquidityMon: formatEther(info.reserveMon),
            },
            'new pair detected',
          );
          await handler(info);
        } catch (err) {
          logger.warn({ err, pair }, 'failed to inspect new pair');
        }
      }
    },
    onError: (err) => logger.error({ err }, 'scanner error'),
  });

  return unwatch;
}

export async function lastKnownPair(
  token: Address,
): Promise<Address | null> {
  const pair = (await publicClient.readContract({
    address: cfg.FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: 'getPair',
    args: [token, cfg.WMON_ADDRESS],
  })) as Address;
  if (pair === '0x0000000000000000000000000000000000000000') return null;
  return pair;
}
