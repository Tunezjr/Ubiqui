import { decodeFunctionData, formatEther, type Address, type Hex } from 'viem';
import { routerAbi } from '../abis.js';
import { explorerTx, publicClient } from '../chain.js';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import type { PositionBook } from '../risk.js';
import { buy, quoteBuy, quoteSell, sell } from '../router.js';

const cfg = loadConfig();

type DecodedSwap = {
  kind: 'buy' | 'sell';
  token: Address;
  amountMon: bigint;
  amountToken?: bigint;
};

export type CopyEvent =
  | { kind: 'mirrored-buy'; leader: Address; token: Address; amountMon: number; tx: string }
  | { kind: 'mirrored-sell'; leader: Address; token: Address; tx: string }
  | { kind: 'skipped'; leader: Address; token: Address; reason: string }
  | { kind: 'error'; leader: Address; token: Address; error: string };

export type CopyListener = (event: CopyEvent) => void;

function decodeSwap(input: Hex, value: bigint): DecodedSwap | null {
  try {
    const { functionName, args } = decodeFunctionData({ abi: routerAbi, data: input });
    const wmon = cfg.WMON_ADDRESS.toLowerCase();

    if (functionName === 'swapExactETHForTokensSupportingFeeOnTransferTokens') {
      const path = args[1] as Address[];
      const token = path[path.length - 1];
      if (!token || path[0]?.toLowerCase() !== wmon) return null;
      return { kind: 'buy', token, amountMon: value };
    }

    if (functionName === 'swapExactTokensForETHSupportingFeeOnTransferTokens') {
      const amountIn = args[0] as bigint;
      const path = args[2] as Address[];
      const token = path[0];
      if (!token || path[path.length - 1]?.toLowerCase() !== wmon) return null;
      return { kind: 'sell', token, amountMon: 0n, amountToken: amountIn };
    }
  } catch {
    return null;
  }
  return null;
}

export class CopyTrader {
  private unwatch?: () => void;
  private listeners = new Set<CopyListener>();
  private watched: Set<string>;

  constructor(private readonly book: PositionBook) {
    this.watched = new Set(cfg.COPY_WALLETS.map((a) => a.toLowerCase()));
  }

  isRunning(): boolean {
    return this.unwatch !== undefined;
  }

  wallets(): Address[] {
    return cfg.COPY_WALLETS;
  }

  on(listener: CopyListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: CopyEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        logger.warn({ err }, 'copy listener threw');
      }
    }
  }

  start(): void {
    if (this.unwatch) return;
    if (this.watched.size === 0) {
      throw new Error('COPY_WALLETS is empty — set at least one leader address');
    }
    logger.info({ wallets: [...this.watched], dryRun: cfg.DRY_RUN }, 'copy trader started');

    this.unwatch = publicClient.watchBlocks({
      onBlock: async (block) => {
        try {
          const full = await publicClient.getBlock({
            blockNumber: block.number,
            includeTransactions: true,
          });
          for (const tx of full.transactions) {
            if (typeof tx === 'string') continue;
            if (!tx.from || !this.watched.has(tx.from.toLowerCase())) continue;
            if (!tx.to || tx.to.toLowerCase() !== cfg.ROUTER_ADDRESS.toLowerCase()) continue;

            const decoded = decodeSwap(tx.input, tx.value);
            if (!decoded) continue;
            await this.mirror(tx.from as Address, decoded);
          }
        } catch (err) {
          logger.warn({ err, block: block.number }, 'copy scan block failed');
        }
      },
      onError: (err) => logger.error({ err }, 'copy watcher error'),
    });
  }

  stop(): void {
    if (!this.unwatch) return;
    this.unwatch();
    this.unwatch = undefined;
    logger.info('copy trader stopped');
  }

  private async mirror(leader: Address, swap: DecodedSwap): Promise<void> {
    if (swap.kind === 'buy') {
      if (!this.book.canOpen()) {
        this.emit({ kind: 'skipped', leader, token: swap.token, reason: 'position cap reached' });
        return;
      }
      const sizeMon = Math.min(cfg.DEFAULT_BUY_MON, Number(formatEther(swap.amountMon)));
      try {
        const quote = await quoteBuy(swap.token, sizeMon);
        const hash = await buy(swap.token, sizeMon);
        await this.book.open(swap.token, quote.amountOut, quote.pricePerToken);
        this.emit({
          kind: 'mirrored-buy',
          leader,
          token: swap.token,
          amountMon: sizeMon,
          tx: explorerTx(hash),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.emit({ kind: 'error', leader, token: swap.token, error: msg });
      }
      return;
    }

    const pos = this.book.list().find((p) => p.token.toLowerCase() === swap.token.toLowerCase());
    if (!pos) {
      this.emit({ kind: 'skipped', leader, token: swap.token, reason: 'no matching open position' });
      return;
    }
    try {
      const quote = await quoteSell(pos.token, pos.amount);
      const hash = await sell(pos.token, pos.amount);
      this.book.close(pos.token, quote.pricePerToken, 'manual');
      this.emit({ kind: 'mirrored-sell', leader, token: swap.token, tx: explorerTx(hash) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit({ kind: 'error', leader, token: swap.token, error: msg });
    }
  }
}
