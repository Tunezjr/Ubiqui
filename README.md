# Ubiqui — Monad Telegram Trading Bot (Vercel)

A MEVX-style trading bot for Monad, deployed as Vercel serverless functions
and driven over Telegram. No dedicated worker host, no VPS — Vercel Cron
ticks the sniper / copy-trader / risk-manager each minute, and Telegram
webhooks handle manual commands.

## Architecture

```
Telegram ──► POST /api/telegram   (webhook, runs on message)
Vercel ───► GET  /api/cron/scan   (every minute — new-pair sniper)
Vercel ───► GET  /api/cron/risk   (every minute — SL / TP / trailing stop)
Vercel ───► GET  /api/cron/copy   (every minute — leader-wallet mirror)
                 │
                 ▼
        Upstash Redis  (open positions, flags, lastBlock, daily PnL)
                 │
                 ▼
         Monad RPC  (quotes, swaps, event logs)
```

Everything is stateless between invocations — state lives in Upstash Redis,
so any function invocation can read and write the same position book.

## Caveats

- **Sniping latency is ~60s.** Vercel Cron's fastest cadence is once per
  minute. That's fine for copy-trading and risk exits; it's not competitive
  for memecoin front-running. For sub-second sniping you need a persistent
  worker (the previous commit had the Docker/Procfile setup for that).
- Each cron tick is capped at `MAX_BLOCKS_PER_TICK` blocks so it finishes
  inside Vercel's `maxDuration`. If you fall behind, drop the cap or raise
  the function duration.
- Cron on the Hobby plan has limits (check Vercel's current quotas). The
  three crons here run once per minute each.

## Deploying

1. Push this repo to GitHub and import it on Vercel. Auto-deploys from the
   configured branch will just work — there is no build step beyond
   TypeScript's type check.
2. Attach an **Upstash Redis** integration from the Vercel Marketplace. It
   provisions `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.
3. In Project Settings → Environment Variables, set everything in
   `.env.example`:
   - `WALLET_PRIVATE_KEY` (0x + 64 hex)
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
   - `TELEGRAM_WEBHOOK_SECRET` (any random string)
   - `MONAD_RPC_URL`, `WMON_ADDRESS`, `ROUTER_ADDRESS`, `FACTORY_ADDRESS`
   - Leave `DRY_RUN=true` until you trust the config.
4. After the first deploy, hit `https://<your-project>.vercel.app/api/setup`
   once in a browser or via `curl`. It registers the Telegram webhook,
   sets the bot's command list, and clears any pending updates.
5. Message the bot on Telegram, send `/help`.

Vercel sets `CRON_SECRET` automatically on production deployments; the cron
endpoints verify it so no one else can trigger them.

## Commands (over Telegram)

| Command | What it does |
| --- | --- |
| `/wallet` | show address + MON balance |
| `/positions` | open positions + daily PnL |
| `/quote <token> [mon]` | round-trip buy/sell quote |
| `/check <token>` | buy-tax / sell-tax probe |
| `/buy <token> [mon]` | market buy with MON |
| `/sell <token>` | sell full wallet balance |
| `/snipe on\|off` | enable / disable the sniper cron |
| `/copy on\|off` | enable / disable copy-trading |
| `/status` | block height, flags, open positions |
| `/settings` | config knobs |
| `/help` | list commands |

Only `TELEGRAM_CHAT_ID` is accepted; every other chat id gets
`unauthorized` and nothing else.

## Strategy toggles

The sniper and copy trader are **off by default**. They don't run just
because the cron is defined; each tick checks a Redis flag that you flip
with `/snipe on` or `/copy on`. That lets you deploy safely and opt in
later.

## Risk management

`api/cron/risk.ts` scans every open position each minute and exits if:

- price is down ≥ `STOP_LOSS_PCT` from entry, or
- price is up ≥ `TAKE_PROFIT_PCT` from entry, or
- price is up from entry but down ≥ `TRAILING_STOP_PCT` from peak.

`openPosition` refuses to add new entries if `MAX_POSITIONS` is reached or
the rolling daily PnL dips below `-MAX_DAILY_LOSS_MON`.

## Local development

```bash
npm install
cp .env.example .env.local
npx vercel dev           # serves /api/* on localhost:3000
```

Use ngrok or `vercel dev --listen` + a tunnel to give Telegram a URL it can
POST to if you want to test the webhook against a real bot.

## Layout

```
api/
  telegram.ts       Telegram webhook
  setup.ts          one-shot setWebhook + setMyCommands
  cron/
    scan.ts         sniper tick
    risk.ts         position manager tick
    copy.ts         copy trader tick
lib/
  config.ts         zod-validated env
  logger.ts         JSON lines → Vercel log drain
  chain.ts          viem Monad clients + wallet
  abis.ts           ERC20 / router / factory / pair ABIs
  tokens.ts         metadata + balance helpers
  router.ts         quote / buy / sell
  scanner.ts        PairCreated log reader
  safety.ts         buy-sell round-trip probe
  state.ts          Upstash Redis wrapper (positions, flags, lastBlock)
  risk.ts           open/close/evaluate positions
  telegram.ts       Telegram API helpers
  commands.ts       command dispatch (shared by webhook)
  cron-auth.ts      verify CRON_SECRET on cron routes
vercel.json         cron schedule + function durations
```

## Safety

- Experimental software. Use testnet until the config is trusted.
- The safety probe is a heuristic, not a honeypot guarantee.
- `WALLET_PRIVATE_KEY` lives in Vercel env vars; never commit it.
- Fund the hot wallet only with what you are willing to lose.
