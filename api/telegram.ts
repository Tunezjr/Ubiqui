import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleCommand } from '../lib/commands.js';
import { loadConfig } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { sendMessage } from '../lib/telegram.js';

type TgUpdate = {
  update_id: number;
  message?: {
    chat: { id: number };
    from?: { id: number };
    text?: string;
  };
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const cfg = loadConfig();

  if (cfg.TELEGRAM_WEBHOOK_SECRET) {
    const provided = req.headers['x-telegram-bot-api-secret-token'];
    if (provided !== cfg.TELEGRAM_WEBHOOK_SECRET) {
      res.status(401).json({ error: 'bad webhook secret' });
      return;
    }
  }

  const update = req.body as TgUpdate;
  const msg = update.message;

  // Always 200 Telegram quickly so it doesn't retry.
  res.status(200).json({ ok: true });

  if (!msg?.text || !msg.chat) return;
  if (String(msg.chat.id) !== String(cfg.TELEGRAM_CHAT_ID)) {
    await sendMessage('unauthorized', String(msg.chat.id));
    return;
  }

  try {
    const reply = await handleCommand(msg.text);
    if (reply) await sendMessage(reply);
  } catch (err) {
    logger.error('command handler failed', { err: String(err) });
    await sendMessage(`⚠️ ${err instanceof Error ? err.message : String(err)}`);
  }
}
