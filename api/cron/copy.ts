import type { VercelRequest, VercelResponse } from '@vercel/node';
import { decodeFunctionData, formatEther, type Address, type Hex } from 'viem';
import { routerAbi } from '../../lib/abis.js';
import { explorerTx, publicClient } from '../../lib/chain.js';
import { loadConfig } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { canOpen, closePosition, openPosition } from '../../lib/risk.js';
import { buy, quoteBuy, quoteSell, sell } from '../../lib/router.js';
import {
  getFlag,
  getLastBlock,
  listPositions,
  setLastBlock,
} from '../../lib/state.js';
import { sendMessage, shortAddr } from '../../lib/telegram.js';
import { verifyCron } from '../../lib/cron-auth.js';

type DecodedSwap =
  | { kind: 'buy'; token: Address; amountMon: bigint }
  | { kind: 'sell'; token: Address; amountToken: bigint };

function decodeSwap(input: Hex, value: bigint, wmon: string): DecodedSwap | null {
  try {
    const { functionName, args } = decodeFunctionData({ abi: routerAbi, data: input });
    if (functionName === 'swapExactETHForTokensSupportingFeeOnTransferTokens') {
      const path = args[1] as Address[];
      const token = path[path.length - 1];
      if (!token || path[0]?.toLowerCase() !== wmon) return null;
      return { kind: 'buy', token, amountMon: value };
    }
    if (functionName === 'swapExactTokensForETHSupportingFeeOnTransferTokens') {
      const amountIn = args[0] as bigint;
      const path = args[2] as Address[];
      const token = path[0];
      if (!token || path[path.length - 1]?.toLowerCase() !== wmon) return null;
      return { kind: 'sell', token, amountToken: amountIn };
    }
  } catch {
    return null;
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!verifyCron(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const cfg = loadConfig();
  if (!(await getFlag('copy'))) {
    res.status(200).json({ ok: true, skipped: 'copy off' });
    return;
  }
  if (cfg.COPY_WALLETS.length === 0) {
    res.status(200).json({ ok: true, skipped: 'no COPY_WALLETS' });
    return;
  }

  const wmon = cfg.WMON_ADDRESS.toLowerCase();
  const router = cfg.ROUTER_ADDRESS.toLowerCase();
  const leaders = new Set(cfg.COPY_WALLETS.map((a) => a.toLowerCase()));

  const tip = await publicClient.getBlockNumber();
  const last = (await getLastBlock('copy')) ?? tip - 1n;
  const from = last + 1n;
  const span = BigInt(cfg.MAX_BLOCKS_PER_TICK);
  const to = tip > from + span ? from + span : tip;
  if (to < from) {
    res.status(200).json({ ok: true, tip: tip.toString() });
    return;
  }

  const mirrored: string[] = [];
  for (let n = from; n <= to; n++) {
    try {
      const block = await publicClient.getBlock({ blockNumber: n, includeTransactions: true });
      for (const tx of block.transactions) {
        if (typeof tx === 'string') continue;
        if (!tx.from || !leaders.has(tx.from.toLowerCase())) continue;
        if (!tx.to || tx.to.toLowerCase() !== router) continue;
        const decoded = decodeSwap(tx.input, tx.value, wmon);
        if (!decoded) continue;
        await mirror(tx.from as Address, decoded);
        mirrored.push(`${tx.from}->${decoded.token}`);
      }
    } catch (err) {
      logger.warn('copy block scan failed', { block: n.toString(), err: String(err) });
    }
  }

  await setLastBlock('copy', to);
  res.status(200).json({
    ok: true,
    from: from.toString(),
    to: to.toString(),
    mirrored,
  });
}

async function mirror(leader: Address, swap: DecodedSwap): Promise<void> {
  const cfg = loadConfig();
  if (swap.kind === 'buy') {
    const gate = await canOpen();
    if (!gate.ok) {
      await sendMessage(`⏭ copy skipped \`${shortAddr(swap.token)}\` — ${gate.reason}`);
      return;
    }
    const sizeMon = Math.min(cfg.DEFAULT_BUY_MON, Number(formatEther(swap.amountMon)));
    try {
      const quote = await quoteBuy(swap.token, sizeMon);
      const hash = await buy(swap.token, sizeMon);
      await openPosition(swap.token, quote.amountOut, quote.pricePerToken);
      await sendMessage(
        `👥 *copy-buy* leader \`${shortAddr(leader)}\` → \`${swap.token}\`\n${sizeMon} MON\n${explorerTx(hash)}`,
      );
    } catch (err) {
      await sendMessage(`⚠️ copy-buy failed \`${shortAddr(swap.token)}\`: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  const positions = await listPositions();
  const pos = positions.find((p) => p.token.toLowerCase() === swap.token.toLowerCase());
  if (!pos) return;
  try {
    const amount = BigInt(pos.amount);
    const quote = await quoteSell(pos.token, amount);
    const hash = await sell(pos.token, amount);
    await closePosition(pos.token, quote.pricePerToken, 'manual');
    await sendMessage(`👥 *copy-sell* leader \`${shortAddr(leader)}\` → \`${shortAddr(swap.token)}\`\n${explorerTx(hash)}`);
  } catch (err) {
    await sendMessage(`⚠️ copy-sell failed \`${shortAddr(swap.token)}\`: ${err instanceof Error ? err.message : String(err)}`);
  }
}
