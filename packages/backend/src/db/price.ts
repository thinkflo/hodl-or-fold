// packages/backend/src/db/price.ts
// D1-backed live price (replaces KV for real-time consistency).
// Prices are rounded to 2 decimals so SSE sends stable values and the frontend
// only triggers change animations when the price actually moves.

import type { D1Database } from '@cloudflare/workers-types';
import type { PricePayload } from '@hodl-or-fold/shared';

const PRICE_KEY = 'btc';

/** Round to 2 decimals so D1/JSON round-trip doesn't create float noise (e.g. 68010.4 vs 68010.400000000001). */
function roundPrice(usd: number): number {
  return Math.round(usd * 100) / 100;
}

export async function getPriceFromDb(db: D1Database): Promise<PricePayload | null> {
  const row = await db
    .prepare('SELECT usd, ts FROM price_feed WHERE k = ?')
    .bind(PRICE_KEY)
    .first<{ usd: number; ts: string }>();

  if (!row || row.usd === 0) return null;
  return { usd: roundPrice(row.usd), ts: row.ts };
}

export async function setPriceInDb(
  db: D1Database,
  payload: PricePayload
): Promise<void> {
  const usd = roundPrice(payload.usd);
  await db
    .prepare('UPDATE price_feed SET usd = ?, ts = ? WHERE k = ?')
    .bind(usd, payload.ts, PRICE_KEY)
    .run();
}
