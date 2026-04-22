import type { Address } from 'viem';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { quoteSell } from './router.js';
import { getTokenMetadata } from './tokens.js';
import { publicClient } from './chain.js';

const cfg = loadConfig();

export type Position = {
  token: Address;
  symbol: string;
  decimals: number;
  amount: bigint;
  entryPriceMon: number;
  peakPriceMon: number;
  openedAt: number;
};

export type ExitReason = 'stop-loss' | 'take-profit' | 'trailing-stop' | 'manual';

export class PositionBook {
  private positions = new Map<Address, Position>();
  private dailyPnlMon = 0;
  private dailyResetAt = Date.now() + 24 * 60 * 60 * 1000;

  size(): number {
    return this.positions.size;
  }

  list(): Position[] {
    return [...this.positions.values()];
  }

  canOpen(): boolean {
    if (this.positions.size >= cfg.MAX_POSITIONS) return false;
    if (this.dailyPnlMon <= -cfg.MAX_DAILY_LOSS_MON) {
      logger.warn({ dailyPnl: this.dailyPnlMon }, 'daily loss limit reached');
      return false;
    }
    return true;
  }

  async open(token: Address, amount: bigint, entryPriceMon: number): Promise<Position> {
    const meta = await getTokenMetadata(publicClient, token);
    const pos: Position = {
      token,
      symbol: meta.symbol,
      decimals: meta.decimals,
      amount,
      entryPriceMon,
      peakPriceMon: entryPriceMon,
      openedAt: Date.now(),
    };
    this.positions.set(token, pos);
    return pos;
  }

  close(token: Address, exitPriceMon: number, reason: ExitReason): Position | undefined {
    const pos = this.positions.get(token);
    if (!pos) return undefined;
    this.positions.delete(token);
    const pnl = (exitPriceMon - pos.entryPriceMon) * (Number(pos.amount) / 10 ** pos.decimals);
    this.rollDaily();
    this.dailyPnlMon += pnl;
    logger.info(
      { token, symbol: pos.symbol, reason, pnlMon: pnl.toFixed(6) },
      'position closed',
    );
    return pos;
  }

  private rollDaily(): void {
    if (Date.now() > this.dailyResetAt) {
      this.dailyPnlMon = 0;
      this.dailyResetAt = Date.now() + 24 * 60 * 60 * 1000;
    }
  }

  /** Returns positions that should be exited along with the reason. */
  async evaluate(): Promise<Array<{ position: Position; reason: ExitReason; price: number }>> {
    const results: Array<{ position: Position; reason: ExitReason; price: number }> = [];
    for (const pos of this.positions.values()) {
      try {
        const quote = await quoteSell(pos.token, pos.amount);
        const price = quote.pricePerToken;
        if (price > pos.peakPriceMon) pos.peakPriceMon = price;

        const changePct = ((price - pos.entryPriceMon) / pos.entryPriceMon) * 100;
        const drawdownPct = ((pos.peakPriceMon - price) / pos.peakPriceMon) * 100;

        if (changePct <= -cfg.STOP_LOSS_PCT) {
          results.push({ position: pos, reason: 'stop-loss', price });
        } else if (changePct >= cfg.TAKE_PROFIT_PCT) {
          results.push({ position: pos, reason: 'take-profit', price });
        } else if (drawdownPct >= cfg.TRAILING_STOP_PCT && changePct > 0) {
          results.push({ position: pos, reason: 'trailing-stop', price });
        }
      } catch (err) {
        logger.warn({ err, token: pos.token }, 'failed to evaluate position');
      }
    }
    return results;
  }
}
