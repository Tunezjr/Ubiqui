import type { VercelRequest } from '@vercel/node';
import { loadConfig } from './config.js';

/**
 * Vercel cron runs authenticate with `Authorization: Bearer <CRON_SECRET>`.
 * If CRON_SECRET isn't configured we allow the call (useful for local `vercel
 * dev`); otherwise the header must match exactly.
 */
export function verifyCron(req: VercelRequest): boolean {
  const cfg = loadConfig();
  if (!cfg.CRON_SECRET) return true;
  const header = req.headers.authorization;
  return header === `Bearer ${cfg.CRON_SECRET}`;
}
