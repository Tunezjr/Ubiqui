# Ubiqui — Monad Telegram Trading Bot

A MEVX-style trading bot for Monad that you drive entirely from Telegram.
No web UI, no public endpoints — the process connects out to Telegram over
long-polling so it can run on any worker host (Fly, Railway, Render, a VPS,
Docker, a Raspberry Pi).

## Features

- **Telegram-native** command interface (`/buy`, `/sell`, `/quote`, `/snipe`,
  `/copy`, `/positions`, …) scoped to a single authorized chat id.
- **Sniper** — listens to `PairCreated` on the DEX factory and auto-buys new
  WMON pairs that pass liquidity + tax heuristics.
- **Copy trader** — mirrors swaps from a list of leader wallets.
- **Risk manager** — per-position stop-loss, take-profit, trailing stop,
  max-position cap, daily loss limit.
- **Dry-run by default** so you can observe before committing capital.

## Quick start (local)

```bash
npm install
cp .env.example .env
# fill in at minimum:
#   WALLET_PRIVATE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
#   ROUTER_ADDRESS, FACTORY_ADDRESS, WMON_ADDRESS
npm run dev
```

Then message your bot on Telegram and send `/help`.

## Quick start (Docker)

```bash
docker build -t ubiqui .
docker run --rm --env-file .env ubiqui
```

## Deploying

The repo ships with three deployment descriptors so common platforms pick it
up without extra config:

| Platform | File | Notes |
| --- | --- | --- |
| Docker / Fly.io / self-host | `Dockerfile` | multi-stage, runs as non-root |
| Heroku / Render (Procfile) | `Procfile` | `release` builds, `worker` runs |
| Railway | `railway.json` | Nixpacks build + `npm start` |

All of them expect the same environment variables (see `.env.example`).
There is no HTTP server to expose — set the dyno/service type to **worker**,
not **web**.

### Avoiding the common deploy failures

- Set every variable in the host's secret manager; a missing `ROUTER_ADDRESS`
  or `WMON_ADDRESS` makes zod reject the config at startup with a clear error.
- Platforms that install only production deps at runtime (Heroku, some
  Railway templates) need the build step to run first. The `Procfile`'s
  `release: npm run build` handles that; for Docker the multi-stage build
  does it. For Nixpacks/Railway, `buildCommand` in `railway.json` runs
  `npm ci && npm run build`.
- `pino-pretty` is kept as a runtime dep so logs stay readable even if the
  host strips devDependencies.
- The bot uses Telegram long-polling, so you do **not** need to expose a port
  or configure a webhook URL.

## Required env vars

| Variable | Why |
| --- | --- |
| `WALLET_PRIVATE_KEY` | 0x-prefixed hex key of the hot wallet |
| `TELEGRAM_BOT_TOKEN` | from @BotFather |
| `TELEGRAM_CHAT_ID` | only this chat can command the bot |
| `MONAD_RPC_URL` | HTTP RPC (HTTPS recommended) |
| `ROUTER_ADDRESS` | V2-style router on your chosen Monad DEX |
| `FACTORY_ADDRESS` | matching factory |
| `WMON_ADDRESS` | wrapped-MON used as the quote asset |

See `.env.example` for the full list (slippage, SL/TP, copy wallets, etc.).

## Commands (over Telegram)

| Command | What it does |
| --- | --- |
| `/wallet` | show address + MON balance |
| `/positions` | list open positions + daily PnL |
| `/quote <token> [mon]` | round-trip buy/sell quote |
| `/check <token>` | buy-tax / sell-tax heuristic |
| `/buy <token> [mon]` | market buy with MON |
| `/sell <token>` | sell full wallet balance |
| `/snipe on\|off` | toggle the sniper loop |
| `/copy on\|off` | toggle the copy trader |
| `/status` | runtime status |
| `/settings` | show config knobs |
| `/help` | list commands |

Any chat id that isn't `TELEGRAM_CHAT_ID` gets `unauthorized` and nothing else.

## Layout

```
src/
  index.ts          entry — boots the Telegram bot
  config.ts         zod-validated env
  logger.ts         pino logger
  chain.ts          viem Monad clients + wallet
  abis.ts           ERC20 / router / factory / pair ABIs
  tokens.ts         metadata + balance helpers
  router.ts         quote / buy / sell against a V2-style router
  scanner.ts        PairCreated watcher
  safety.ts         buy-sell round-trip probe
  risk.ts           position book with SL / TP / trailing exits
  telegram.ts       long-poll bot (commands + outgoing notifications)
  notifier.ts       thin re-export for internal call sites
  strategies/
    snipe.ts        Sniper class (start/stop)
    copy.ts         CopyTrader class (start/stop)
```

## Safety

- Experimental software. Use testnet until the config is trusted.
- The safety probe is a heuristic, not a honeypot guarantee.
- `WALLET_PRIVATE_KEY` lives in `.env`; keep it out of git.
- Fund the hot wallet only with what you are willing to lose.
