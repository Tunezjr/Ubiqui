import { parseEther, type Address } from 'viem';
import { loadConfig } from './config.js';
import { quoteBuy, quoteSell } from './router.js';
import { logger } from './logger.js';

const cfg = loadConfig();

export type SafetyReport = {
  ok: boolean;
  buyTaxBps: number;
  sellTaxBps: number;
  reasons: string[];
};

/**
 * Probe a token by quoting a tiny round-trip buy+sell. Non-authoritative —
 * a real honeypot check should simulate the swap; this heuristic is useful to
 * reject obvious fee-on-transfer traps before committing capital.
 */
export async function checkToken(token: Address): Promise<SafetyReport> {
  const reasons: string[] = [];
  const probeMon = 0.01;
  const probeIn = parseEther(probeMon.toString());

  const buy = await quoteBuy(token, probeMon);
  if (buy.amountOut === 0n) {
    return { ok: false, buyTaxBps: 10_000, sellTaxBps: 10_000, reasons: ['no buy liquidity'] };
  }
  const sell = await quoteSell(token, buy.amountOut);

  const roundTrip = Number(sell.amountOut) / Number(probeIn);
  const lossBps = Math.round((1 - roundTrip) * 10_000);
  const buyTaxBps = Math.max(0, Math.round(lossBps / 2));
  const sellTaxBps = Math.max(0, lossBps - buyTaxBps);

  if (buyTaxBps > cfg.MAX_BUY_TAX_BPS) reasons.push(`buy tax too high: ${buyTaxBps} bps`);
  if (sellTaxBps > cfg.MAX_BUY_TAX_BPS) reasons.push(`sell tax too high: ${sellTaxBps} bps`);
  if (sell.amountOut === 0n) reasons.push('cannot sell');

  const report = { ok: reasons.length === 0, buyTaxBps, sellTaxBps, reasons };
  logger.debug({ token, ...report }, 'safety probe');
  return report;
}
