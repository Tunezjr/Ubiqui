import PQueue from 'p-queue';
import { explorerTx } from '../chain.js';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import type { PositionBook } from '../risk.js';
import { buy, quoteBuy } from '../router.js';
import { checkToken } from '../safety.js';
import { onNewPair } from '../scanner.js';

const cfg = loadConfig();

export type SniperEvent =
  | { kind: 'entered'; token: `0x${string}`; amountMon: number; price: number; tx: string }
  | { kind: 'skipped'; token: `0x${string}`; reason: string }
  | { kind: 'error'; token: `0x${string}`; error: string };

export type SniperListener = (event: SniperEvent) => void;

export class Sniper {
  private unwatch?: () => void;
  private queue = new PQueue({ concurrency: 1 });
  private listeners = new Set<SniperListener>();

  constructor(private readonly book: PositionBook) {}

  isRunning(): boolean {
    return this.unwatch !== undefined;
  }

  on(listener: SniperListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: SniperEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        logger.warn({ err }, 'sniper listener threw');
      }
    }
  }

  start(): void {
    if (this.unwatch) return;
    logger.info(
      { dryRun: cfg.DRY_RUN, buyMon: cfg.DEFAULT_BUY_MON, slippageBps: cfg.SLIPPAGE_BPS },
      'sniper started',
    );

    this.unwatch = onNewPair(async (pair) => {
      await this.queue.add(async () => {
        if (!this.book.canOpen()) {
          this.emit({ kind: 'skipped', token: pair.token, reason: 'position cap or daily loss limit' });
          return;
        }

        if (cfg.HONEYPOT_CHECK) {
          const report = await checkToken(pair.token);
          if (!report.ok) {
            this.emit({ kind: 'skipped', token: pair.token, reason: report.reasons.join('; ') });
            return;
          }
        }

        try {
          const quote = await quoteBuy(pair.token, cfg.DEFAULT_BUY_MON);
          const hash = await buy(pair.token, cfg.DEFAULT_BUY_MON);
          await this.book.open(pair.token, quote.amountOut, quote.pricePerToken);
          this.emit({
            kind: 'entered',
            token: pair.token,
            amountMon: cfg.DEFAULT_BUY_MON,
            price: quote.pricePerToken,
            tx: explorerTx(hash),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error({ err, token: pair.token }, 'snipe failed');
          this.emit({ kind: 'error', token: pair.token, error: msg });
        }
      });
    });
  }

  stop(): void {
    if (!this.unwatch) return;
    this.unwatch();
    this.unwatch = undefined;
    logger.info('sniper stopped');
  }
}
