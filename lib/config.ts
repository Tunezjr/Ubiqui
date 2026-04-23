import { z } from 'zod';
import { isAddress, type Address } from 'viem';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const addr = z
  .string()
  .refine((s) => isAddress(s), 'expected a 0x-prefixed address')
  .transform((s) => s as Address);

const num = (fallback: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number().finite());

const schema = z.object({
  MONAD_RPC_URL: z.string().url(),
  MONAD_CHAIN_ID: num(10143),
  MONAD_EXPLORER: z.string().url().default('https://testnet.monadexplorer.com'),

  WALLET_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'WALLET_PRIVATE_KEY must be 0x + 64 hex chars')
    .optional(),

  WMON_ADDRESS: addr,
  ROUTER_ADDRESS: addr,
  FACTORY_ADDRESS: addr,

  DEFAULT_BUY_MON: num(0.5),
  SLIPPAGE_BPS: num(150),
  MAX_PRIORITY_FEE_GWEI: num(2),
  GAS_LIMIT: num(450_000),

  MAX_POSITIONS: num(5),
  STOP_LOSS_PCT: num(25),
  TAKE_PROFIT_PCT: num(80),
  TRAILING_STOP_PCT: num(15),
  MAX_DAILY_LOSS_MON: num(5),

  MIN_LIQUIDITY_MON: num(25),
  MAX_BUY_TAX_BPS: num(500),
  HONEYPOT_CHECK: bool.default(true),
  MAX_BLOCKS_PER_TICK: num(2000),

  COPY_WALLETS: z
    .string()
    .optional()
    .transform((s) =>
      (s ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .filter((x) => isAddress(x)) as Address[],
    ),

  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  CRON_SECRET: z.string().optional(),

  KV_REST_API_URL: z.string().url(),
  KV_REST_API_TOKEN: z.string().min(1),

  DRY_RUN: bool.default(true),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

export function loadConfig(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
