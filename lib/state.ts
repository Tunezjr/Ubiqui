import { Redis } from '@upstash/redis';
import type { Address } from 'viem';
import { loadConfig } from './config.js';

const cfg = loadConfig();

export const redis = new Redis({
  url: cfg.KV_REST_API_URL,
  token: cfg.KV_REST_API_TOKEN,
});

const K = {
  positions: 'ubiqui:positions',
  lastBlock: (name: string) => `ubiqui:lastBlock:${name}`,
  flag: (name: string) => `ubiqui:flag:${name}`,
  dailyPnl: 'ubiqui:dailyPnl',
  dailyPnlDay: 'ubiqui:dailyPnl:day',
} as const;

export type StoredPosition = {
  token: Address;
  symbol: string;
  decimals: number;
  amount: string; // bigint stringified
  entryPriceMon: number;
  peakPriceMon: number;
  openedAt: number;
};

export async function savePosition(pos: StoredPosition): Promise<void> {
  await redis.hset(K.positions, { [pos.token.toLowerCase()]: JSON.stringify(pos) });
}

export async function deletePosition(token: Address): Promise<void> {
  await redis.hdel(K.positions, token.toLowerCase());
}

export async function getPosition(token: Address): Promise<StoredPosition | null> {
  const raw = await redis.hget<string>(K.positions, token.toLowerCase());
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as StoredPosition);
}

export async function listPositions(): Promise<StoredPosition[]> {
  const all = (await redis.hgetall<Record<string, string>>(K.positions)) ?? {};
  return Object.values(all).map((v) => (typeof v === 'string' ? JSON.parse(v) : v));
}

export async function positionCount(): Promise<number> {
  return (await redis.hlen(K.positions)) ?? 0;
}

export async function getLastBlock(name: string): Promise<bigint | null> {
  const v = await redis.get<string | number>(K.lastBlock(name));
  return v === null || v === undefined ? null : BigInt(v);
}

export async function setLastBlock(name: string, block: bigint): Promise<void> {
  await redis.set(K.lastBlock(name), block.toString());
}

export async function getFlag(name: string): Promise<boolean> {
  return (await redis.get<string>(K.flag(name))) === 'on';
}

export async function setFlag(name: string, on: boolean): Promise<void> {
  await redis.set(K.flag(name), on ? 'on' : 'off');
}

export async function addDailyPnl(pnl: number): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const currentDay = await redis.get<string>(K.dailyPnlDay);
  if (currentDay !== today) {
    await redis.set(K.dailyPnlDay, today);
    await redis.set(K.dailyPnl, 0);
  }
  return (await redis.incrbyfloat(K.dailyPnl, pnl)) ?? 0;
}

export async function getDailyPnl(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const currentDay = await redis.get<string>(K.dailyPnlDay);
  if (currentDay !== today) return 0;
  const v = await redis.get<number | string>(K.dailyPnl);
  return v === null || v === undefined ? 0 : Number(v);
}
