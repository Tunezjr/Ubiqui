import type { VercelRequest, VercelResponse } from '@vercel/node';
import { explorerTx } from '../../lib/chain.js';
import { evaluateAndExit } from '../../lib/risk.js';
import { sendMessage } from '../../lib/telegram.js';
import { verifyCron } from '../../lib/cron-auth.js';
import type { Hex } from 'viem';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!verifyCron(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const exits = await evaluateAndExit();
  for (const exit of exits) {
    await sendMessage(
      `🏁 *exit* \`${exit.position.token}\` (${exit.reason}) @ ${exit.price.toExponential(4)} MON\n${explorerTx(exit.tx as Hex)}`,
    );
  }

  res.status(200).json({ ok: true, exits: exits.length });
}
