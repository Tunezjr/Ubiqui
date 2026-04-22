import { formatEther, isAddress, type Address } from 'viem';
import { explorerAddr, explorerTx, getWallet, publicClient } from './chain.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { PositionBook } from './risk.js';
import { buy, quoteBuy, quoteSell, sell } from './router.js';
import { checkToken } from './safety.js';
import { CopyTrader } from './strategies/copy.js';
import { Sniper } from './strategies/snipe.js';
import { getBalance, getTokenMetadata } from './tokens.js';

const cfg = loadConfig();

type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; username?: string };
    text?: string;
  };
};

const API = cfg.TELEGRAM_BOT_TOKEN ? `https://api.telegram.org/bot${cfg.TELEGRAM_BOT_TOKEN}` : '';

async function tg<T>(method: string, body: Record<string, unknown>): Promise<T> {
  if (!API) throw new Error('TELEGRAM_BOT_TOKEN not set');
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`telegram ${method} failed: ${json.description}`);
  return json.result;
}

export async function sendMessage(text: string): Promise<void> {
  if (!API || !cfg.TELEGRAM_CHAT_ID) return;
  try {
    await tg('sendMessage', {
      chat_id: cfg.TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
  } catch (err) {
    logger.warn({ err }, 'telegram send failed');
  }
}

const HELP = [
  '*Ubiqui — Monad trading bot*',
  '',
  '/wallet — show address + MON balance',
  '/positions — list open positions',
  '/quote `<token>` `[mon]` — round-trip quote',
  '/check `<token>` — safety probe',
  '/buy `<token>` `[mon]` — market buy with MON',
  '/sell `<token>` — sell full balance',
  '/snipe on|off — toggle new-pair sniper',
  '/copy on|off — toggle copy trader',
  '/status — show runtime status',
  '/settings — show config knobs',
  '/help — this message',
].join('\n');

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function requireAuth(chatId: number): boolean {
  if (!cfg.TELEGRAM_CHAT_ID) return false;
  return String(chatId) === String(cfg.TELEGRAM_CHAT_ID);
}

export async function runTelegramBot(): Promise<void> {
  if (!cfg.TELEGRAM_BOT_TOKEN || !cfg.TELEGRAM_CHAT_ID) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required');
  }

  const book = new PositionBook();
  const sniper = new Sniper(book);
  const copier = new CopyTrader(book);

  sniper.on((event) => {
    if (event.kind === 'entered') {
      void sendMessage(
        `🎯 *sniped* \`${event.token}\`\n${event.amountMon} MON in @ ${event.price.toExponential(4)}\n${event.tx}`,
      );
    } else if (event.kind === 'skipped') {
      void sendMessage(`⏭ skipped \`${short(event.token)}\` — ${event.reason}`);
    } else {
      void sendMessage(`⚠️ snipe error \`${short(event.token)}\`: ${event.error}`);
    }
  });

  copier.on((event) => {
    if (event.kind === 'mirrored-buy') {
      void sendMessage(
        `👥 *copy-buy* leader \`${short(event.leader)}\` → \`${event.token}\`\n${event.amountMon} MON\n${event.tx}`,
      );
    } else if (event.kind === 'mirrored-sell') {
      void sendMessage(`👥 *copy-sell* leader \`${short(event.leader)}\` → \`${short(event.token)}\`\n${event.tx}`);
    } else if (event.kind === 'error') {
      void sendMessage(`⚠️ copy error \`${short(event.token)}\`: ${event.error}`);
    }
  });

  book.onExit((event) => {
    void sendMessage(
      `🏁 *exit* \`${event.position.token}\` (${event.reason}) @ ${event.price.toExponential(4)} MON${event.tx ? `\n${event.tx}` : ''}`,
    );
  });
  book.startAutoExit();

  await tg('setMyCommands', {
    commands: [
      { command: 'wallet', description: 'show address + MON balance' },
      { command: 'positions', description: 'list open positions' },
      { command: 'quote', description: 'round-trip quote for a token' },
      { command: 'check', description: 'safety probe a token' },
      { command: 'buy', description: 'market buy with MON' },
      { command: 'sell', description: 'sell full balance of a token' },
      { command: 'snipe', description: 'toggle sniper (on/off)' },
      { command: 'copy', description: 'toggle copy trader (on/off)' },
      { command: 'status', description: 'runtime status' },
      { command: 'settings', description: 'show config knobs' },
      { command: 'help', description: 'show help' },
    ],
  });
  await sendMessage(`✅ Ubiqui online${cfg.DRY_RUN ? ' (DRY_RUN)' : ''}\nSend /help for commands.`);

  let offset = 0;
  let running = true;
  const shutdown = async (): Promise<void> => {
    running = false;
    sniper.stop();
    copier.stop();
    book.stopAutoExit();
    await sendMessage('👋 Ubiqui shutting down');
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  while (running) {
    try {
      const updates = await tg<TgUpdate[]>('getUpdates', {
        offset,
        timeout: 50,
        allowed_updates: ['message'],
      });
      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        await handleUpdate(update, { book, sniper, copier });
      }
    } catch (err) {
      logger.warn({ err }, 'telegram poll error');
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
}

type Ctx = { book: PositionBook; sniper: Sniper; copier: CopyTrader };

async function handleUpdate(update: TgUpdate, ctx: Ctx): Promise<void> {
  const msg = update.message;
  if (!msg?.text || !msg.chat) return;
  if (!requireAuth(msg.chat.id)) {
    await tg('sendMessage', {
      chat_id: msg.chat.id,
      text: 'unauthorized',
    });
    return;
  }

  const [rawCmd, ...args] = msg.text.trim().split(/\s+/);
  if (!rawCmd) return;
  const cmd = rawCmd.replace(/@.+$/, '').toLowerCase();

  try {
    await dispatch(cmd, args, ctx);
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    await sendMessage(`⚠️ ${text}`);
  }
}

async function dispatch(cmd: string, args: string[], ctx: Ctx): Promise<void> {
  switch (cmd) {
    case '/start':
    case '/help':
      await sendMessage(HELP);
      return;

    case '/wallet': {
      const { address } = getWallet();
      const balance = await publicClient.getBalance({ address });
      await sendMessage(
        `*wallet*\n\`${address}\`\nbalance: ${formatEther(balance)} MON\n${explorerAddr(address)}`,
      );
      return;
    }

    case '/positions': {
      const list = ctx.book.list();
      if (list.length === 0) {
        await sendMessage('no open positions');
        return;
      }
      const lines = list.map((p) => {
        const human = Number(p.amount) / 10 ** p.decimals;
        return `• *${p.symbol}* \`${short(p.token)}\`\n   ${human.toFixed(4)} @ ${p.entryPriceMon.toExponential(3)} MON`;
      });
      await sendMessage(`*open positions (${list.length})*\n${lines.join('\n')}\n\ndaily pnl: ${ctx.book.dailyPnl().toFixed(4)} MON`);
      return;
    }

    case '/quote': {
      const token = parseToken(args[0]);
      const amount = Number(args[1] ?? cfg.DEFAULT_BUY_MON);
      const meta = await getTokenMetadata(publicClient, token);
      const b = await quoteBuy(token, amount);
      const s = await quoteSell(token, b.amountOut);
      const loss = ((1 - Number(s.amountOut) / Number(b.amountIn)) * 100).toFixed(2);
      await sendMessage(
        `*quote* ${meta.symbol} \`${short(token)}\`\nbuy ${amount} MON → ${(Number(b.amountOut) / 10 ** meta.decimals).toFixed(4)} ${meta.symbol}\nround-trip loss: ${loss}%`,
      );
      return;
    }

    case '/check': {
      const token = parseToken(args[0]);
      const report = await checkToken(token);
      await sendMessage(
        `*safety* \`${short(token)}\`\nbuy tax: ${report.buyTaxBps} bps\nsell tax: ${report.sellTaxBps} bps\n${report.ok ? '✅ passes' : `❌ ${report.reasons.join('; ')}`}`,
      );
      return;
    }

    case '/buy': {
      const token = parseToken(args[0]);
      const amount = Number(args[1] ?? cfg.DEFAULT_BUY_MON);
      if (!ctx.book.canOpen()) {
        await sendMessage('position cap or daily loss limit reached');
        return;
      }
      const quote = await quoteBuy(token, amount);
      const hash = await buy(token, amount);
      await ctx.book.open(token, quote.amountOut, quote.pricePerToken);
      await sendMessage(`✅ buy \`${short(token)}\` ${amount} MON\n${explorerTx(hash)}`);
      return;
    }

    case '/sell': {
      const token = parseToken(args[0]);
      const { address } = getWallet();
      const balance = await getBalance(publicClient, token, address);
      if (balance === 0n) {
        await sendMessage('wallet holds 0 of that token');
        return;
      }
      const quote = await quoteSell(token, balance);
      const hash = await sell(token, balance);
      ctx.book.close(token, quote.pricePerToken, 'manual');
      await sendMessage(`✅ sell \`${short(token)}\`\n${explorerTx(hash)}`);
      return;
    }

    case '/snipe': {
      const verb = (args[0] ?? '').toLowerCase();
      if (verb === 'on') {
        ctx.sniper.start();
        await sendMessage('🎯 sniper *on*');
      } else if (verb === 'off') {
        ctx.sniper.stop();
        await sendMessage('🛑 sniper *off*');
      } else {
        await sendMessage(`sniper: ${ctx.sniper.isRunning() ? 'on' : 'off'}\nusage: /snipe on|off`);
      }
      return;
    }

    case '/copy': {
      const verb = (args[0] ?? '').toLowerCase();
      if (verb === 'on') {
        ctx.copier.start();
        await sendMessage(`👥 copy trader *on* — ${ctx.copier.wallets().length} leader(s)`);
      } else if (verb === 'off') {
        ctx.copier.stop();
        await sendMessage('🛑 copy trader *off*');
      } else {
        await sendMessage(`copy: ${ctx.copier.isRunning() ? 'on' : 'off'}\nusage: /copy on|off`);
      }
      return;
    }

    case '/status': {
      const block = await publicClient.getBlockNumber();
      await sendMessage(
        `*status*\nblock: ${block}\nsniper: ${ctx.sniper.isRunning() ? 'on' : 'off'}\ncopy: ${ctx.copier.isRunning() ? 'on' : 'off'}\nopen positions: ${ctx.book.size()}/${cfg.MAX_POSITIONS}\ndry run: ${cfg.DRY_RUN}`,
      );
      return;
    }

    case '/settings': {
      await sendMessage(
        [
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
        ].join('\n'),
      );
      return;
    }

    default:
      await sendMessage('unknown command — send /help');
  }
}

function parseToken(input?: string): Address {
  if (!input || !isAddress(input)) throw new Error('expected a 0x-prefixed token address');
  return input as Address;
}
