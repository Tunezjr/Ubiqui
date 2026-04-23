import { maxUint256, parseEther, parseUnits, type Address, type Hex } from 'viem';
import { erc20Abi, routerAbi } from './abis.js';
import { getWallet, publicClient } from './chain.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { getTokenMetadata } from './tokens.js';

const cfg = loadConfig();

export type Quote = {
  amountIn: bigint;
  amountOut: bigint;
  path: Address[];
  pricePerToken: number;
};

function deadline(secondsFromNow = 60): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + secondsFromNow);
}

function applySlippage(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}

export async function quoteBuy(token: Address, amountInMon: number): Promise<Quote> {
  const amountIn = parseEther(amountInMon.toString());
  const path = [cfg.WMON_ADDRESS, token];
  const amounts = (await publicClient.readContract({
    address: cfg.ROUTER_ADDRESS,
    abi: routerAbi,
    functionName: 'getAmountsOut',
    args: [amountIn, path],
  })) as readonly bigint[];
  const amountOut = amounts[amounts.length - 1] ?? 0n;
  const meta = await getTokenMetadata(publicClient, token);
  const price = Number(amountIn) / 1e18 / (Number(amountOut) / 10 ** meta.decimals);
  return { amountIn, amountOut, path: path as Address[], pricePerToken: price };
}

export async function quoteSell(token: Address, amountInToken: bigint): Promise<Quote> {
  const path = [token, cfg.WMON_ADDRESS];
  const amounts = (await publicClient.readContract({
    address: cfg.ROUTER_ADDRESS,
    abi: routerAbi,
    functionName: 'getAmountsOut',
    args: [amountInToken, path],
  })) as readonly bigint[];
  const amountOut = amounts[amounts.length - 1] ?? 0n;
  const meta = await getTokenMetadata(publicClient, token);
  const price = Number(amountOut) / 1e18 / (Number(amountInToken) / 10 ** meta.decimals);
  return { amountIn: amountInToken, amountOut, path: path as Address[], pricePerToken: price };
}

export async function buy(token: Address, amountInMon: number): Promise<Hex> {
  const { client, address } = getWallet();
  const quote = await quoteBuy(token, amountInMon);
  const minOut = applySlippage(quote.amountOut, cfg.SLIPPAGE_BPS);

  if (cfg.DRY_RUN) {
    logger.info('DRY_RUN buy — not sending tx', {
      token,
      amountInMon,
      expectedOut: quote.amountOut.toString(),
    });
    return '0xdryrun' as Hex;
  }

  return client.writeContract({
    account: client.account!,
    chain: client.chain!,
    address: cfg.ROUTER_ADDRESS,
    abi: routerAbi,
    functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
    args: [minOut, quote.path, address, deadline()],
    value: quote.amountIn,
    gas: BigInt(cfg.GAS_LIMIT),
    maxPriorityFeePerGas: parseUnits(cfg.MAX_PRIORITY_FEE_GWEI.toString(), 9),
  });
}

async function ensureApproval(token: Address, spender: Address, owner: Address): Promise<void> {
  const current = (await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
  })) as bigint;
  if (current >= maxUint256 / 2n) return;
  if (cfg.DRY_RUN) return;

  const { client } = getWallet();
  const hash = await client.writeContract({
    account: client.account!,
    chain: client.chain!,
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, maxUint256],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

export async function sell(token: Address, amountInToken: bigint): Promise<Hex> {
  const { client, address } = getWallet();
  await ensureApproval(token, cfg.ROUTER_ADDRESS, address);

  const quote = await quoteSell(token, amountInToken);
  const minOut = applySlippage(quote.amountOut, cfg.SLIPPAGE_BPS);

  if (cfg.DRY_RUN) {
    logger.info('DRY_RUN sell — not sending tx', {
      token,
      amountIn: amountInToken.toString(),
      expectedOut: quote.amountOut.toString(),
    });
    return '0xdryrun' as Hex;
  }

  return client.writeContract({
    account: client.account!,
    chain: client.chain!,
    address: cfg.ROUTER_ADDRESS,
    abi: routerAbi,
    functionName: 'swapExactTokensForETHSupportingFeeOnTransferTokens',
    args: [amountInToken, minOut, quote.path, address, deadline()],
    gas: BigInt(cfg.GAS_LIMIT),
    maxPriorityFeePerGas: parseUnits(cfg.MAX_PRIORITY_FEE_GWEI.toString(), 9),
  });
}
