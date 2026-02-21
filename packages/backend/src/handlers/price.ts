// packages/backend/src/handlers/price.ts
// GET /price — returns the latest BTC/USD price from D1 (price_feed).
//
// Design notes:
// - D1 is the source of truth. This handler never calls Binance/CoinGecko.
// - Returns 503 if no price yet (e.g. first cron hasn't run).
// - Used by POST /guesses to lock the entry price server-side at submission time.

import type { Env } from '../db/client';
import { getPriceFromDb } from '../db/price';

export async function getPrice(env: Env): Promise<Response> {
  const cached = await getPriceFromDb(env.DB);

  if (!cached) {
    return new Response(
      JSON.stringify({ error: 'Price unavailable', unavailable: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(JSON.stringify(cached), {
    headers: { 'Content-Type': 'application/json' },
  });
}
