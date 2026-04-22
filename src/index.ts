import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { runTelegramBot } from './telegram.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  logger.info(
    {
      chainId: cfg.MONAD_CHAIN_ID,
      dryRun: cfg.DRY_RUN,
      hasWallet: Boolean(cfg.WALLET_PRIVATE_KEY),
      copyWallets: cfg.COPY_WALLETS.length,
    },
    'ubiqui starting',
  );

  await runTelegramBot();
}

main().catch((err) => {
  logger.error({ err }, 'fatal');
  process.exit(1);
});
