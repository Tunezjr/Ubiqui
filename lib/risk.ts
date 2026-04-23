import type { Address } from 'viem';
import { publicClient } from './chain.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { quoteSell, sell } from './router.js';
import {
  addDailyPnl,
  deletePosition,
  getDailyPnl,
  listPositions,
  positionCount,
  savePosition,
  type StoredPosition,
} from './state.js';
import { getTokenMetadata } from './tokens.js';

const cfg = loadConfig();

export type ExitReason = 'stop-loss' | 'take-profit' | 'trailing-stop' | 'manual';

export async function canOpen(): Promise<{ ok: boolean; reason?: string }> {
  const count = await positionCount();
  if (count >= cfg.MAX_POSITIONS) return { ok: false, reason: 'max positions reached' };
  const pnl = await getDailyPnl();
  if (pnl <= -cfg.MAX_DAILY_LOSS_MON) return { ok: false, reason: 'daily loss cap hit' };
  return { ok: true };
}

export async function openPosition(
  token: Address,
  amount: bigint,
  entryPriceMon: number,
): Promise<StoredPosition> {
  const meta = await getTokenMetadata(publicClient, token);
  const pos: StoredPosition = {
    token,
    symbol: meta.symbol,
    decimals: meta.decimals,
    amount: amount.toString(),
    entryPriceMon,
    peakPriceMon: entryPriceMon,
    openedAt: Date.now(),
  };
  await savePosition(pos);
  return pos;
}

export async function closePosition(
  token: Address,
  exitPriceMon: number,
  reason: ExitReason,
): Promise<StoredPosition | null> {
  const positions = await listPositions();
  const pos = positions.find((p) => p.token.toLowerCase() === token.toLowerCase());
  if (!pos) return null;
  await deletePosition(token);
  const pnl = (exitPriceMon - pos.entryPriceMon) * (Number(BigInt(pos.amount)) / 10 ** pos.decimals);
  await addDailyPnl(pnl);
  logger.info('position closed', { token, symbol: pos.symbol, reason, pnl: pnl.toFixed(6) });
  return pos;
}

export type ExitAction = {
  position: StoredPosition;
  reason: ExitReason;
  price: number;
  tx: string;
};

export async function evaluateAndExit(): Promise<ExitAction[]> {
  const actions: ExitAction[] = [];
  const positions = await listPositions();
  for (const pos of positions) {
    try {
      const amount = BigInt(pos.amount);
      const quote = await quoteSell(pos.token, amount);
      const price = quote.pricePerToken;
      const peak = Math.max(pos.peakPriceMon, price);

      const changePct = ((price - pos.entryPriceMon) / pos.entryPriceMon) * 100;
      const drawdownPct = ((peak - price) / peak) * 100;

      let reason: ExitReason | null = null;
      if (changePct <= -cfg.STOP_LOSS_PCT) reason = 'stop-loss';
      else if (changePct >= cfg.TAKE_PROFIT_PCT) reason = 'take-profit';
      else if (drawdownPct >= cfg.TRAILING_STOP_PCT && changePct > 0) reason = 'trailing-stop';

      if (!reason) {
        if (peak !== pos.peakPriceMon) {
          await savePosition({ ...pos, peakPriceMon: peak });
        }
        continue;
      }

      const hash = await sell(pos.token, amount);
      await closePosition(pos.token, price, reason);
      actions.push({ position: pos, reason, price, tx: String(hash) });
    } catch (err) {
      logger.warn('failed to evaluate position', { token: pos.token, err: String(err) });
    }
  }
  return actions;
}
