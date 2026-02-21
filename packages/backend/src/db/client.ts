// packages/backend/src/db/client.ts
// Cloudflare Worker environment bindings.
// Secrets (API_SECRET, MAX_PLAYERS) are set via `wrangler secret put` and
// never committed to source control.

export interface Env {
  // D1 database — players, guesses, scores, and price_feed (live BTC price)
  DB: D1Database;

  // Secret injected by wrangler secret put; validated on every request
  API_SECRET: string;

  // Maximum simultaneous active players (default: 100)
  MAX_PLAYERS: string;
}
