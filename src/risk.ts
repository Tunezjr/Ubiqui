import type { Address } from 'viem';
import { publicClient } from './chain.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { quoteSell } from './router.js';
import { getTokenMetadata } from './tokens.js';

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

export type ExitEvent = {
  position: Position;
  reason: ExitReason;
  price: number;
  tx?: string;
};

type ExitListener = (event: ExitEvent) => void;

export class PositionBook {
  private positions = new Map<Address, Position>();
  private dailyPnlMon = 0;
  private dailyResetAt = Date.now() + 24 * 60 * 60 * 1000;
  private evalTimer?: NodeJS.Timeout;
  private exitListeners = new Set<ExitListener>();

  size(): number {
    return this.positions.size;
  }

  list(): Position[] {
    return [...this.positions.values()];
  }

  dailyPnl(): number {
    return this.dailyPnlMon;
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
    logger.info({ token, symbol: pos.symbol, reason, pnlMon: pnl.toFixed(6) }, 'position closed');
    return pos;
  }

  onExit(listener: ExitListener): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  startAutoExit(intervalMs = 15_000): void {
    if (this.evalTimer) return;
    this.evalTimer = setInterval(() => {
      void this.runEvaluation();
    }, intervalMs);
  }

  stopAutoExit(): void {
    if (!this.evalTimer) return;
    clearInterval(this.evalTimer);
    this.evalTimer = undefined;
  }

  private async runEvaluation(): Promise<void> {
    const { sell } = await import('./router.js');
    for (const pos of [...this.positions.values()]) {
      try {
        const quote = await quoteSell(pos.token, pos.amount);
        const price = quote.pricePerToken;
        if (price > pos.peakPriceMon) pos.peakPriceMon = price;

        const changePct = ((price - pos.entryPriceMon) / pos.entryPriceMon) * 100;
        const drawdownPct = ((pos.peakPriceMon - price) / pos.peakPriceMon) * 100;

        let reason: ExitReason | null = null;
        if (changePct <= -cfg.STOP_LOSS_PCT) reason = 'stop-loss';
        else if (changePct >= cfg.TAKE_PROFIT_PCT) reason = 'take-profit';
        else if (drawdownPct >= cfg.TRAILING_STOP_PCT && changePct > 0) reason = 'trailing-stop';
        if (!reason) continue;

        const hash = await sell(pos.token, pos.amount);
        this.close(pos.token, price, reason);
        for (const l of this.exitListeners) {
          try {
            l({ position: pos, reason, price, tx: hash });
          } catch (err) {
            logger.warn({ err }, 'exit listener threw');
          }
        }
      } catch (err) {
        logger.warn({ err, token: pos.token }, 'failed to evaluate position');
      }
    }
  }

  private rollDaily(): void {
    if (Date.now() > this.dailyResetAt) {
      this.dailyPnlMon = 0;
      this.dailyResetAt = Date.now() + 24 * 60 * 60 * 1000;
    }
  }
}
