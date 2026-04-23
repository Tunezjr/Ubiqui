import { loadConfig } from './config.js';
import { logger } from './logger.js';

const cfg = loadConfig();
const API = `https://api.telegram.org/bot${cfg.TELEGRAM_BOT_TOKEN}`;

export async function tg<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`telegram ${method} failed: ${json.description}`);
  return json.result;
}

export async function sendMessage(text: string, chatId?: string): Promise<void> {
  try {
    await tg('sendMessage', {
      chat_id: chatId ?? cfg.TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
  } catch (err) {
    logger.warn('telegram send failed', { err: String(err) });
  }
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
