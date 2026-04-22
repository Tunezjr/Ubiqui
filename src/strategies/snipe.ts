import PQueue from 'p-queue';
import { formatEther, parseEther } from 'viem';
import { explorerTx, publicClient } from '../chain.js';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { notify } from '../notifier.js';
import { PositionBook } from '../risk.js';
import { buy, sell, quoteBuy } from '../router.js';
import { checkToken } from '../safety.js';
import { onNewPair } from '../scanner.js';

const cfg = loadConfig();

export async function runSniper(): Promise<void> {
  const book = new PositionBook();
  const queue = new PQueue({ concurrency: 1 });

  logger.info(
    { dryRun: cfg.DRY_RUN, buyMon: cfg.DEFAULT_BUY_MON, slippageBps: cfg.SLIPPAGE_BPS },
    'sniper started',
  );

  const unwatch = onNewPair(async (pair) => {
    await queue.add(async () => {
      if (!book.canOpen()) {
        logger.info('position cap or daily loss limit reached — skipping');
        return;
      }

      if (cfg.HONEYPOT_CHECK) {
        const report = await checkToken(pair.token);
        if (!report.ok) {
          logger.warn({ token: pair.token, ...report }, 'token failed safety check');
          return;
        }
      }

      const quote = await quoteBuy(pair.token, cfg.DEFAULT_BUY_MON);
      try {
        const hash = await buy(pair.token, cfg.DEFAULT_BUY_MON);
        await book.open(pair.token, quote.amountOut, quote.pricePerToken);
        const msg = `*snipe* \`${pair.token}\` — ${cfg.DEFAULT_BUY_MON} MON in\nentry: ${quote.pricePerToken.toExponential(4)} MON\n${explorerTx(hash)}`;
        logger.info({ token: pair.token, hash }, 'sniped');
        await notify(msg);
      } catch (err) {
        logger.error({ err, token: pair.token }, 'snipe failed');
      }
    });
  });

  const riskTimer = setInterval(() => {
    void (async () => {
      const exits = await book.evaluate();
      for (const { position, reason, price } of exits) {
        try {
          const hash = await sell(position.token, position.amount);
          book.close(position.token, price, reason);
          await notify(`*exit* \`${position.token}\` (${reason}) @ ${price.toExponential(4)} MON\n${explorerTx(hash)}`);
        } catch (err) {
          logger.error({ err, token: position.token }, 'exit failed');
        }
      }
    })();
  }, 15_000);

  const shutdown = (): void => {
    logger.info('shutting down sniper');
    clearInterval(riskTimer);
    unwatch();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // keep the event loop alive by reporting wallet block height every minute
  setInterval(async () => {
    try {
      const block = await publicClient.getBlockNumber();
      logger.debug(
        { block: block.toString(), open: book.size(), buy: formatEther(parseEther(cfg.DEFAULT_BUY_MON.toString())) },
        'heartbeat',
      );
    } catch (err) {
      logger.warn({ err }, 'heartbeat failed');
    }
  }, 60_000);
}
