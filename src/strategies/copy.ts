import { decodeFunctionData, formatEther, type Address, type Hex } from 'viem';
import { routerAbi } from '../abis.js';
import { explorerTx, publicClient } from '../chain.js';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { notify } from '../notifier.js';
import { PositionBook } from '../risk.js';
import { buy, sell, quoteBuy, quoteSell } from '../router.js';

const cfg = loadConfig();

type DecodedSwap = {
  kind: 'buy' | 'sell';
  token: Address;
  amountMon: bigint;
  amountToken?: bigint;
};

function decodeSwap(input: Hex, value: bigint): DecodedSwap | null {
  try {
    const { functionName, args } = decodeFunctionData({ abi: routerAbi, data: input });
    const wmon = cfg.WMON_ADDRESS.toLowerCase();

    if (
      functionName === 'swapExactETHForTokensSupportingFeeOnTransferTokens'
    ) {
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

export async function runCopyTrader(): Promise<void> {
  if (cfg.COPY_WALLETS.length === 0) {
    throw new Error('COPY_WALLETS is empty — add at least one address to .env');
  }

  const watched = new Set(cfg.COPY_WALLETS.map((a) => a.toLowerCase()));
  const book = new PositionBook();
  logger.info({ wallets: cfg.COPY_WALLETS, dryRun: cfg.DRY_RUN }, 'copy trader started');

  const unwatch = publicClient.watchBlocks({
    onBlock: async (block) => {
      try {
        const full = await publicClient.getBlock({ blockNumber: block.number, includeTransactions: true });
        for (const tx of full.transactions) {
          if (typeof tx === 'string') continue;
          if (!tx.from || !watched.has(tx.from.toLowerCase())) continue;
          if (!tx.to || tx.to.toLowerCase() !== cfg.ROUTER_ADDRESS.toLowerCase()) continue;

          const decoded = decodeSwap(tx.input, tx.value);
          if (!decoded) continue;
          await mirror(book, tx.from as Address, decoded);
        }
      } catch (err) {
        logger.warn({ err, block: block.number }, 'copy scan block failed');
      }
    },
    onError: (err) => logger.error({ err }, 'copy watcher error'),
  });

  process.on('SIGINT', () => {
    unwatch();
    process.exit(0);
  });
}

async function mirror(
  book: PositionBook,
  leader: Address,
  swap: DecodedSwap,
): Promise<void> {
  if (swap.kind === 'buy') {
    if (!book.canOpen()) return;
    const sizeMon = Math.min(cfg.DEFAULT_BUY_MON, Number(formatEther(swap.amountMon)));
    try {
      const quote = await quoteBuy(swap.token, sizeMon);
      const hash = await buy(swap.token, sizeMon);
      await book.open(swap.token, quote.amountOut, quote.pricePerToken);
      await notify(
        `*copy-buy* leader \`${leader}\` → \`${swap.token}\` for ${sizeMon} MON\n${explorerTx(hash)}`,
      );
    } catch (err) {
      logger.error({ err, token: swap.token }, 'copy buy failed');
    }
  } else {
    const pos = book.list().find((p) => p.token.toLowerCase() === swap.token.toLowerCase());
    if (!pos) return;
    try {
      const quote = await quoteSell(pos.token, pos.amount);
      const hash = await sell(pos.token, pos.amount);
      book.close(pos.token, quote.pricePerToken, 'manual');
      await notify(
        `*copy-sell* leader \`${leader}\` → \`${swap.token}\`\n${explorerTx(hash)}`,
      );
    } catch (err) {
      logger.error({ err, token: swap.token }, 'copy sell failed');
    }
  }
}
