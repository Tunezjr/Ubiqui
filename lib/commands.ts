import { formatEther, isAddress, type Address } from 'viem';
import { explorerAddr, explorerTx, getWallet, publicClient } from './chain.js';
import { loadConfig } from './config.js';
import { canOpen, closePosition, openPosition } from './risk.js';
import { buy, quoteBuy, quoteSell, sell } from './router.js';
import { checkToken } from './safety.js';
import {
  getDailyPnl,
  getFlag,
  listPositions,
  positionCount,
  setFlag,
} from './state.js';
import { sendMessage, shortAddr } from './telegram.js';
import { getBalance, getTokenMetadata } from './tokens.js';

const cfg = loadConfig();

const HELP = [
  '*Ubiqui — Monad trading bot*',
  '',
  '/wallet — address + MON balance',
  '/positions — open positions',
  '/quote `<token>` `[mon]` — round-trip quote',
  '/check `<token>` — safety probe',
  '/buy `<token>` `[mon]` — market buy',
  '/sell `<token>` — sell full balance',
  '/snipe on|off — toggle sniper',
  '/copy on|off — toggle copy trader',
  '/status — runtime status',
  '/settings — config knobs',
  '/help — this message',
].join('\n');

export async function handleCommand(text: string): Promise<string> {
  const [rawCmd, ...args] = text.trim().split(/\s+/);
  if (!rawCmd) return '';
  const cmd = rawCmd.replace(/@.+$/, '').toLowerCase();

  switch (cmd) {
    case '/start':
    case '/help':
      return HELP;

    case '/wallet': {
      const { address } = getWallet();
      const balance = await publicClient.getBalance({ address });
      return `*wallet*\n\`${address}\`\nbalance: ${formatEther(balance)} MON\n${explorerAddr(address)}`;
    }

    case '/positions': {
      const list = await listPositions();
      if (list.length === 0) return 'no open positions';
      const lines = list.map((p) => {
        const human = Number(BigInt(p.amount)) / 10 ** p.decimals;
        return `• *${p.symbol}* \`${shortAddr(p.token)}\`\n   ${human.toFixed(4)} @ ${p.entryPriceMon.toExponential(3)} MON`;
      });
      const pnl = await getDailyPnl();
      return `*open positions (${list.length})*\n${lines.join('\n')}\n\ndaily pnl: ${pnl.toFixed(4)} MON`;
    }

    case '/quote': {
      const token = requireAddress(args[0]);
      const amount = Number(args[1] ?? cfg.DEFAULT_BUY_MON);
      const meta = await getTokenMetadata(publicClient, token);
      const b = await quoteBuy(token, amount);
      const s = await quoteSell(token, b.amountOut);
      const loss = ((1 - Number(s.amountOut) / Number(b.amountIn)) * 100).toFixed(2);
      return `*quote* ${meta.symbol} \`${shortAddr(token)}\`\nbuy ${amount} MON → ${(Number(b.amountOut) / 10 ** meta.decimals).toFixed(4)} ${meta.symbol}\nround-trip loss: ${loss}%`;
    }

    case '/check': {
      const token = requireAddress(args[0]);
      const report = await checkToken(token);
      return `*safety* \`${shortAddr(token)}\`\nbuy tax: ${report.buyTaxBps} bps\nsell tax: ${report.sellTaxBps} bps\n${report.ok ? '✅ passes' : `❌ ${report.reasons.join('; ')}`}`;
    }

    case '/buy': {
      const token = requireAddress(args[0]);
      const amount = Number(args[1] ?? cfg.DEFAULT_BUY_MON);
      const gate = await canOpen();
      if (!gate.ok) return `❌ ${gate.reason}`;
      const quote = await quoteBuy(token, amount);
      const hash = await buy(token, amount);
      await openPosition(token, quote.amountOut, quote.pricePerToken);
      return `✅ buy \`${shortAddr(token)}\` ${amount} MON\n${explorerTx(hash)}`;
    }

    case '/sell': {
      const token = requireAddress(args[0]);
      const { address } = getWallet();
      const balance = await getBalance(publicClient, token, address);
      if (balance === 0n) return 'wallet holds 0 of that token';
      const quote = await quoteSell(token, balance);
      const hash = await sell(token, balance);
      await closePosition(token, quote.pricePerToken, 'manual');
      return `✅ sell \`${shortAddr(token)}\`\n${explorerTx(hash)}`;
    }

    case '/snipe': {
      const verb = (args[0] ?? '').toLowerCase();
      if (verb === 'on' || verb === 'off') {
        await setFlag('snipe', verb === 'on');
        return `🎯 sniper *${verb}*`;
      }
      return `sniper: ${(await getFlag('snipe')) ? 'on' : 'off'}\nusage: /snipe on|off`;
    }

    case '/copy': {
      const verb = (args[0] ?? '').toLowerCase();
      if (verb === 'on' || verb === 'off') {
        if (verb === 'on' && cfg.COPY_WALLETS.length === 0) {
          return '❌ COPY_WALLETS is empty — set leader addresses first';
        }
        await setFlag('copy', verb === 'on');
        return `👥 copy trader *${verb}* — ${cfg.COPY_WALLETS.length} leader(s)`;
      }
      return `copy: ${(await getFlag('copy')) ? 'on' : 'off'}\nusage: /copy on|off`;
    }

    case '/status': {
      const [block, snipe, copy, count, pnl] = await Promise.all([
        publicClient.getBlockNumber(),
        getFlag('snipe'),
        getFlag('copy'),
        positionCount(),
        getDailyPnl(),
      ]);
      return [
        '*status*',
        `block: ${block}`,
        `sniper: ${snipe ? 'on' : 'off'}`,
        `copy: ${copy ? 'on' : 'off'}`,
        `open positions: ${count}/${cfg.MAX_POSITIONS}`,
        `daily pnl: ${pnl.toFixed(4)} MON`,
        `dry run: ${cfg.DRY_RUN}`,
      ].join('\n');
    }

    case '/settings':
      return [
        '*settings*',
        `chain id: ${cfg.MONAD_CHAIN_ID}`,
        `default buy: ${cfg.DEFAULT_BUY_MON} MON`,
        `slippage: ${cfg.SLIPPAGE_BPS} bps`,
        `max positions: ${cfg.MAX_POSITIONS}`,
        `SL / TP / trail: ${cfg.STOP_LOSS_PCT}% / ${cfg.TAKE_PROFIT_PCT}% / ${cfg.TRAILING_STOP_PCT}%`,
        `daily loss cap: ${cfg.MAX_DAILY_LOSS_MON} MON`,
        `min liquidity: ${cfg.MIN_LIQUIDITY_MON} MON`,
        `max buy tax: ${cfg.MAX_BUY_TAX_BPS} bps`,
        `copy wallets: ${cfg.COPY_WALLETS.length}`,
        `dry run: ${cfg.DRY_RUN}`,
      ].join('\n');

    default:
      return 'unknown command — send /help';
  }
}

export async function reply(text: string): Promise<void> {
  await sendMessage(text);
}

function requireAddress(input?: string): Address {
  if (!input || !isAddress(input)) throw new Error('expected a 0x-prefixed token address');
  return input as Address;
}
