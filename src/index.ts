#!/usr/bin/env node
import { Command } from 'commander';
import { formatEther, isAddress, type Address } from 'viem';
import { getWallet, publicClient, explorerAddr } from './chain.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { buy, quoteBuy, quoteSell, sell } from './router.js';
import { checkToken } from './safety.js';
import { runCopyTrader } from './strategies/copy.js';
import { runSniper } from './strategies/snipe.js';
import { getBalance, getTokenMetadata } from './tokens.js';

const program = new Command();
program
  .name('ubiqui')
  .description('Ubiqui — MEVX-style Monad trading bot')
  .version('0.1.0');

program
  .command('wallet')
  .description('print wallet address and native balance')
  .action(async () => {
    const { address } = getWallet();
    const balance = await publicClient.getBalance({ address });
    logger.info({ address, balanceMon: formatEther(balance), url: explorerAddr(address) }, 'wallet');
  });

program
  .command('quote')
  .description('show a buy & sell quote for a token')
  .argument('<token>', 'ERC-20 token address')
  .option('-a, --amount <mon>', 'MON amount for the buy quote', '0.1')
  .action(async (token: string, opts: { amount: string }) => {
    if (!isAddress(token)) throw new Error('invalid token address');
    const meta = await getTokenMetadata(publicClient, token as Address);
    const b = await quoteBuy(token as Address, Number(opts.amount));
    const s = await quoteSell(token as Address, b.amountOut);
    const roundTripLoss = 1 - Number(s.amountOut) / Number(b.amountIn);
    logger.info(
      {
        token,
        symbol: meta.symbol,
        decimals: meta.decimals,
        buyPrice: b.pricePerToken,
        sellPrice: s.pricePerToken,
        roundTripLossPct: (roundTripLoss * 100).toFixed(2),
      },
      'quote',
    );
  });

program
  .command('check')
  .description('safety-probe a token (buy-tax / sell-tax / honeypot heuristic)')
  .argument('<token>', 'ERC-20 token address')
  .action(async (token: string) => {
    if (!isAddress(token)) throw new Error('invalid token address');
    const report = await checkToken(token as Address);
    logger.info(report, 'safety report');
  });

program
  .command('buy')
  .description('buy a token with MON')
  .argument('<token>', 'ERC-20 token address')
  .option('-a, --amount <mon>', 'MON amount', String(loadConfig().DEFAULT_BUY_MON))
  .action(async (token: string, opts: { amount: string }) => {
    if (!isAddress(token)) throw new Error('invalid token address');
    const hash = await buy(token as Address, Number(opts.amount));
    logger.info({ hash }, 'buy submitted');
  });

program
  .command('sell')
  .description('sell the full wallet balance of a token back to MON')
  .argument('<token>', 'ERC-20 token address')
  .action(async (token: string) => {
    if (!isAddress(token)) throw new Error('invalid token address');
    const { address } = getWallet();
    const balance = await getBalance(publicClient, token as Address, address);
    if (balance === 0n) throw new Error('wallet holds 0 of that token');
    const hash = await sell(token as Address, balance);
    logger.info({ hash, amount: balance.toString() }, 'sell submitted');
  });

program
  .command('snipe')
  .description('watch the factory for new pairs and auto-buy')
  .action(async () => {
    await runSniper();
  });

program
  .command('copy')
  .description('mirror swaps from the wallets in COPY_WALLETS')
  .action(async () => {
    await runCopyTrader();
  });

program.parseAsync(process.argv).catch((err) => {
  logger.error({ err }, 'fatal');
  process.exit(1);
});
