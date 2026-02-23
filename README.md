# Hodl or Fold

> Will BTC rise or fall in 60 seconds?

Real-time Bitcoin price prediction game. Players call HODL (price goes up) or
FOLD (price goes down) over a 60-second window. Built on Cloudflare's edge
platform — Workers, D1, and Pages.

Live at https://hodl-or-fold.pages.dev

---

## Quick start

```bash
# Prerequisites: Node.js 20.x, pnpm 9.x, wrangler CLI
npm install -g wrangler
pnpm install

# Backend — first-time setup
cd packages/backend
wrangler login
wrangler d1 create hodl-or-fold-db          # copy database_id → wrangler.toml
wrangler d1 execute hodl-or-fold-db --file=src/db/migrations/001_initial.sql
wrangler d1 execute hodl-or-fold-db --file=src/db/migrations/002_price_feed.sql
wrangler secret put API_SECRET              # e.g. openssl rand -hex 32
wrangler secret put MAX_PLAYERS             # e.g. 100

# Local dev — apply migrations to local D1
wrangler d1 execute hodl-or-fold-db --local --file=src/db/migrations/001_initial.sql
wrangler d1 execute hodl-or-fold-db --local --file=src/db/migrations/002_price_feed.sql

# Run backend locally
wrangler dev
# Note: cron does not run in wrangler dev. The first /price or /price/stream
# request triggers a one-off fetch so you see a BTC price without seeding.

# Frontend (separate terminal)
cd packages/frontend
cp .env.example .env                        # set WORKER_URL and API_SECRET
pnpm dev
```

### Local dev environment

The frontend reads `WORKER_URL` and `API_SECRET` from `.env` (or `.env.local`).
The backend reads secrets from `.dev.vars` (same directory as `wrangler.toml`).
See `.env.example` and `.dev.vars.example` for both setups:

- **Local frontend + remote backend** — point `WORKER_URL` at the deployed Worker
- **Local frontend + local backend** — point `WORKER_URL` at `http://127.0.0.1:8787`

Both `.env` and `.dev.vars` are gitignored; the `.example` files are committed.

> **Note:** The cron-based BTC price feed cannot be replicated locally. When
> testing the frontend locally, point `WORKER_URL` at the live deployed Worker
> so the price feed and SSE stream work correctly.

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
│   │       │   └── priceFetcher.ts # 30-iteration cron loop → D1 price_feed
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
│               │   └── CapacityScreen.svelte
│               └── utils/
│                   ├── priceAnimation.ts  # tween, FLIP, canvas chart
│                   └── proxy.ts           # Worker proxy helper
└── packages/shared/
```

---

## Architecture

**Browser** → SvelteKit API routes (Cloudflare Pages) → Cloudflare Worker → D1

The browser never contacts the Worker directly. All requests go through SvelteKit
server routes which inject `x-api-secret` from a Pages environment variable.

**Price feed:**
- Cron fires every minute; loops 30 iterations × 2s internally → writes to D1 `price_feed` table
- Price sources: Kraken → Binance → CoinGecko (tried in order; first success wins)
- SSE stream (`GET /price/stream`) reads D1 every 2s, broadcasts to all connected clients
- D1 gives read-after-write consistency so clients see updates within ~2s
- Client subscribes via `EventSource` which auto-reconnects on drop
- In local dev (no cron), the first `/price` or `/price/stream` request triggers a one-off fetch

**Resolution** (two conditions, both required):
1. ≥ 60 seconds elapsed since `guessed_at`
2. Current D1 price ≠ `price_at_guess`

The client triggers a `GET /guesses/:id` call when its local timer expires AND
the SSE price has moved. The server independently re-validates both conditions
and is the sole authority on the outcome.

**Game phases:**
- `idle` — live BTC price, HODL/FOLD buttons
- `guessing` — 60s countdown, live chart, entry card
- `waiting` — timer done but price hasn't moved yet (hourglass)
- `resolved` — win/loss result, PLAY AGAIN

**Session persistence:** Browser stores a UUID in localStorage. On reload,
`POST /players` restores score and any pending guess (including `guessed_at`
timestamp so the countdown resumes accurately).

---

## Spec conformance

| Requirement | Implementation |
|---|---|
| Server-side entry price lock | `POST /guesses` reads D1 `price_feed` at submission time |
| Two-condition resolution | `resolve.ts` — timer + price movement, both required |
| Indefinite wait if price frozen | `awaiting_price_change` reason, no timeout |
| Session persistence | localStorage UUID + D1 upsert + `POST /players` restore |
| Capacity limit (100 users) | `POST /players` rejects 101st active player with 503 |
| Secret never in browser | SvelteKit proxy injects `x-api-secret` server-side |
| D1 never public | Worker bindings only — no public endpoints |
| Price from D1 only at resolution | `resolve.ts` reads D1; never calls external APIs |
| Idempotent resolution | Already-resolved guess returns existing outcome |

---

## Deploy

```bash
# Backend (Worker)
pnpm deploy:backend

# Frontend (Pages) — preview deploy (main branch alias)
pnpm deploy:frontend

# Frontend (Pages) — production deploy (hodl-or-fold.pages.dev)
cd packages/frontend && pnpm deploy:prod
```

Set these in the Cloudflare Pages dashboard (Settings → Environment Variables):
- `WORKER_URL` — deployed Worker URL (e.g. `https://hodl-or-fold-api.workers.dev`)
- `API_SECRET` — must match the secret set in the Worker

---

## AWS migration path

This project uses Cloudflare Workers, D1, and Pages in place of the AWS stack
suggested in the brief. The decision was made on cost and simplicity grounds —
the architecture is equivalent in capability and effectively free at evaluation
scale.

The migration path to AWS is straightforward:

| Cloudflare | AWS equivalent |
|---|---|
| Workers | Lambda + API Gateway |
| D1 (SQLite) | RDS PostgreSQL (schema ports directly) |
| Pages | S3 + CloudFront |
| Cron Trigger | EventBridge Scheduled Rule → Lambda |
| SSE stream | API Gateway HTTP APIs (native SSE support) |

The D1 SQLite schema requires no changes to run on RDS PostgreSQL — all queries
use standard SQL with no SQLite-specific syntax. The Worker handlers port
directly to Lambda with an Express or Hono wrapper. The SvelteKit frontend
deploys to S3/CloudFront unchanged.

The primary operational difference is cost: the equivalent AWS architecture
(Lambda + RDS t4g.micro + API Gateway + WAF + Secrets Manager + VPC) runs
approximately $24/month at idle before any traffic, versus effectively $0 on
Cloudflare at this scale.

---

## Tests

```bash
pnpm test
```

Covers all resolution cases: timer, awaiting_price_change, price_unavailable,
correct/wrong for each direction, idempotency.