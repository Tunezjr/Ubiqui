import type { VercelRequest, VercelResponse } from '@vercel/node';
import { explorerTx, publicClient } from '../../lib/chain.js';
import { loadConfig } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { canOpen, openPosition } from '../../lib/risk.js';
import { buy, quoteBuy } from '../../lib/router.js';
import { checkToken } from '../../lib/safety.js';
import { fetchNewPairs } from '../../lib/scanner.js';
import { getFlag, getLastBlock, setLastBlock } from '../../lib/state.js';
import { sendMessage, shortAddr } from '../../lib/telegram.js';
import { verifyCron } from '../../lib/cron-auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!verifyCron(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const cfg = loadConfig();
  if (!(await getFlag('snipe'))) {
    res.status(200).json({ ok: true, skipped: 'sniper off' });
    return;
  }

  const tip = await publicClient.getBlockNumber();
  const last = (await getLastBlock('scan')) ?? tip - 1n;
  const from = last + 1n;
  const span = BigInt(cfg.MAX_BLOCKS_PER_TICK);
  const to = tip > from + span ? from + span : tip;
  if (to < from) {
    res.status(200).json({ ok: true, tip: tip.toString() });
    return;
  }

  const pairs = await fetchNewPairs(from, to);
  const entered: string[] = [];

  for (const pair of pairs) {
    const gate = await canOpen();
    if (!gate.ok) {
      await sendMessage(`⏭ sniper skipped \`${shortAddr(pair.token)}\` — ${gate.reason}`);
      break;
    }
    if (cfg.HONEYPOT_CHECK) {
      const report = await checkToken(pair.token);
      if (!report.ok) {
        await sendMessage(`⏭ sniper skipped \`${shortAddr(pair.token)}\` — ${report.reasons.join('; ')}`);
        continue;
      }
    }
    try {
      const quote = await quoteBuy(pair.token, cfg.DEFAULT_BUY_MON);
      const hash = await buy(pair.token, cfg.DEFAULT_BUY_MON);
      await openPosition(pair.token, quote.amountOut, quote.pricePerToken);
      entered.push(pair.token);
      await sendMessage(
        `🎯 *sniped* \`${pair.token}\`\n${cfg.DEFAULT_BUY_MON} MON in @ ${quote.pricePerToken.toExponential(4)}\n${explorerTx(hash)}`,
      );
    } catch (err) {
      logger.error('snipe failed', { token: pair.token, err: String(err) });
      await sendMessage(`⚠️ snipe failed \`${shortAddr(pair.token)}\`: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await setLastBlock('scan', to);
  res.status(200).json({
    ok: true,
    from: from.toString(),
    to: to.toString(),
    pairsFound: pairs.length,
    entered,
  });
}
