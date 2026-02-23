# Hodl or Fold

> Will BTC hold or fold in 60 seconds?

Real-time Bitcoin price prediction game. Players bet HODL (price rises) or FOLD
(price falls) over a 60-second window. Built on Cloudflare's edge platform.

Live at https://hodl-or-fold.pages.dev

---

## Quick start

```bash
# Prerequisites: Node.js 20.x, pnpm 9.x, wrangler CLI
npm install -g wrangler
pnpm install

# Backend
cd packages/backend
wrangler login
wrangler d1 create hodl-or-fold-db          # copy database_id → wrangler.toml
wrangler d1 execute hodl-or-fold-db --file=src/db/migrations/001_initial.sql
wrangler d1 execute hodl-or-fold-db --file=src/db/migrations/002_price_feed.sql
wrangler secret put API_SECRET              # openssl rand -hex 32
wrangler secret put MAX_PLAYERS             # e.g. 100
wrangler dev                                # local Worker + miniflare

# Frontend (separate terminal)
cd packages/frontend
pnpm dev
```

---

## Structure

```
hodl-or-fold/
├── packages/
│   ├── shared/                     # Shared TypeScript types (no runtime deps)
│   │   └── src/index.ts
│   ├── backend/                    # Cloudflare Worker
│   │   └── src/
│   │       ├── index.ts            # fetch + scheduled entry point
│   │       ├── middleware/auth.ts  # x-api-secret validation
│   │       ├── handlers/
│   │       │   ├── price.ts        # GET /price
│   │       │   ├── price-stream.ts # GET /price/stream (SSE)
│   │       │   ├── players.ts      # POST /players, GET /players/:id
│   │       │   ├── guesses.ts      # POST /guesses, GET /guesses/:id
│   │       │   └── resolve.ts      # two-condition resolution logic
│   │       ├── cron/
│   │       │   └── priceFetcher.ts # 60-iteration cron loop → D1 price_feed
│   │       └── db/
│   │           ├── client.ts       # Env type definition
│   │           ├── price.ts        # get/set price from D1
│   │           └── migrations/
│   │               ├── 001_initial.sql
│   │               └── 002_price_feed.sql
│   └── frontend/                   # SvelteKit app (Cloudflare Pages)
│       └── src/
│           ├── routes/
│           │   ├── +page.ts        # load() → player session restore
│           │   ├── +page.svelte    # main game UI
│           │   └── api/            # SvelteKit proxy → Worker (injects secret)
│           └── lib/
│               ├── stores/game.ts  # all game state, SSE feed, resolution
│               ├── components/
│               │   ├── PriceDisplay.svelte
│               │   ├── PendingGuess.svelte
│               │   ├── GuessButtons.svelte
│               │   └── CapacityScreen.svelte
│               └── utils/
│                   ├── priceAnimation.ts  # tween, FLIP, chart renderer
│                   └── proxy.ts           # Worker proxy helper
└── packages/shared/
```

---

## Architecture

**Browser** → SvelteKit API routes (Cloudflare Pages) → Cloudflare Worker → D1

The browser never contacts the Worker directly. All requests go through SvelteKit
server routes which inject `x-api-secret` from a Pages environment variable.

**Price feed** (spec §5):
- Cron fires every minute, loops 60 × 1s internally → writes to D1 `price_feed` table
- SSE stream (`GET /price/stream`) reads D1 every second, pushes to all clients (strong consistency)
- Client subscribes via `EventSource` which auto-reconnects on drop

**Resolution** (spec §5.7 — two conditions, both required):
1. ≥ 60 seconds elapsed since `guessed_at`
2. Current D1 price ≠ `price_at_guess`

The client triggers a `GET /guesses/:id` call when its local timer expires AND
the SSE price has moved. The server independently re-validates both conditions
and is the sole authority on the outcome.

---

## Spec conformance

| Requirement | Implementation |
|---|---|
| Server-side entry price lock | `POST /guesses` reads KV at submission time |
| Two-condition resolution | `resolve.ts` — timer + price movement, both required |
| Indefinite wait if price frozen | `awaiting_price_change` reason, no timeout |
| Session persistence | localStorage UUID + D1 upsert + `GET /players/:id` restore |
| Capacity limit (100 users) | `POST /players` rejects 101st active player with 503 |
| Secret never in browser | SvelteKit proxy injects `x-api-secret` server-side |
| D1/KV never public | Worker bindings only — no public endpoints |
| Price from KV only at resolution | `resolve.ts` reads KV; never calls Binance/CoinGecko |
| Idempotent resolution | Already-resolved guess returns existing outcome |

---

## Deploy

```bash
cd packages/backend  && wrangler deploy
cd packages/frontend && wrangler pages deploy .svelte-kit/cloudflare
```

Set these in the Cloudflare Pages dashboard (Settings → Environment Variables):
- `WORKER_URL` — deployed Worker URL (e.g. `https://hodl-or-fold-api.workers.dev`)
- `API_SECRET`  — must match the secret set in the Worker

---

## Tests

```bash
cd packages/backend && pnpm test
```

Covers all resolution cases from spec §9.1: timer, awaiting_price_change,
price_unavailable, correct/wrong for each direction, idempotency.
