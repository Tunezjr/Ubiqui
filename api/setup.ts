import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadConfig } from '../lib/config.js';
import { tg } from '../lib/telegram.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const cfg = loadConfig();
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  if (!host) {
    res.status(500).json({ error: 'cannot determine deployment host' });
    return;
  }
  const url = `https://${host}/api/telegram`;

  await tg('setWebhook', {
    url,
    allowed_updates: ['message'],
    secret_token: cfg.TELEGRAM_WEBHOOK_SECRET || undefined,
    drop_pending_updates: true,
  });

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

  const info = await tg<unknown>('getWebhookInfo', {});
  res.status(200).json({ ok: true, webhook: url, info });
}
