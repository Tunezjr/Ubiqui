# Ubiqui — Monad Trading Bot

A MEVX-style trading bot for the Monad network. Written in TypeScript on top of
`viem`. Runs three strategies out of the box:

- **Sniper** — listens to `PairCreated` on the DEX factory and auto-buys new
  WMON pairs that pass a liquidity + tax heuristic.
- **Copy trader** — mirrors swaps from a configurable set of leader wallets.
- **Manual** — `quote`, `buy`, `sell`, `check` commands for one-off trading.

Position management (stop-loss, take-profit, trailing stop, max-positions,
daily loss cap) runs in-process for any position the bot opens.

## Requirements

- Node.js 20+
- A Monad RPC endpoint (HTTP; optionally WebSocket for faster event streaming)
- A funded wallet private key

## Setup

```bash
npm install
cp .env.example .env
# fill in WALLET_PRIVATE_KEY, ROUTER_ADDRESS, FACTORY_ADDRESS, WMON_ADDRESS
```

The defaults point at Monad testnet. For mainnet, swap the RPC, chain id, and
the router/factory/WMON addresses of your target DEX.

`DRY_RUN=true` (the default) quotes and logs every trade but does not submit
transactions. Flip it to `false` only once you have verified a strategy's
behaviour.

## Commands

```bash
npm run dev -- wallet                       # show address + MON balance
npm run dev -- quote 0xTOKEN --amount 0.5   # round-trip quote
npm run dev -- check 0xTOKEN                # tax/honeypot probe
npm run dev -- buy   0xTOKEN --amount 0.5
npm run dev -- sell  0xTOKEN
npm run dev -- snipe                        # run the sniper
npm run dev -- copy                         # run the copy trader
```

Build for production:

```bash
npm run build
node dist/index.js snipe
```

## Configuration

See `.env.example` for the full list. Key knobs:

| Variable | Purpose |
| --- | --- |
| `DEFAULT_BUY_MON` | Size of each auto-buy |
| `SLIPPAGE_BPS` | Slippage tolerance in basis points |
| `MIN_LIQUIDITY_MON` | Reject new pairs with less WMON liquidity than this |
| `MAX_BUY_TAX_BPS` | Reject tokens whose round-trip tax exceeds this |
| `STOP_LOSS_PCT` / `TAKE_PROFIT_PCT` / `TRAILING_STOP_PCT` | Risk exits |
| `MAX_POSITIONS` | Cap on concurrent open positions |
| `MAX_DAILY_LOSS_MON` | Hard stop — no new entries once this is breached |
| `COPY_WALLETS` | Comma-separated leader addresses for `copy` |

## Safety notes

- This is experimental software. The safety probe is a heuristic, not a
  guarantee; plenty of malicious tokens will pass it.
- Run on testnet until you trust the config.
- Keep `WALLET_PRIVATE_KEY` out of version control. `.env` is already gitignored.
- Use a dedicated "hot" wallet funded only with what you are willing to lose.

## Layout

```
src/
  index.ts            CLI entry
  config.ts           env parsing (zod)
  logger.ts           pino logger
  chain.ts            viem clients + wallet
  abis.ts             ERC20 / router / factory / pair ABIs
  tokens.ts           metadata + balance helpers
  router.ts           quote / buy / sell against a V2-style router
  scanner.ts          new-pair watcher
  safety.ts           buy-sell round-trip probe
  risk.ts             position book with SL/TP/trailing exits
  notifier.ts         optional Telegram notifications
  strategies/
    snipe.ts          sniper loop
    copy.ts           leader-wallet mirror
```
