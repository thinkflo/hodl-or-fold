// packages/backend/src/cron/priceFetcher.ts
// Fetches BTC/USD price every ~2s (30 iterations) and writes to D1 (price_feed table).
// Price sources tried in order: Kraken → Binance → CoinGecko
// All responses are fully consumed to avoid Workers fetch deadlock.

import type { Env } from '../db/client';
import { setPriceInDb } from '../db/price';

const HEADERS = {
  'User-Agent': 'hodl-or-fold/1.0',
  'Accept': 'application/json',
};

async function fetchBtcPrice(): Promise<number> {
  // ── 1. Kraken — most reliable from Cloudflare Workers ──────────────────
  try {
    const res = await fetch(
      'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
      { headers: HEADERS }
    );
    const text = await res.text(); // always consume body
    if (res.ok) {
      const data = JSON.parse(text);
      const price = parseFloat(data?.result?.XXBTZUSD?.c?.[0]);
      if (price > 0) return price;
    }
  } catch (e) {
    console.warn('Kraken failed:', e);
  }

  // ── 2. Binance ───────────────────────────────────────────────────────────
  try {
    const res = await fetch(
      'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
      { headers: HEADERS }
    );
    const text = await res.text();
    if (res.ok) {
      const data = JSON.parse(text);
      const price = parseFloat(data?.price);
      if (price > 0) return price;
    }
    console.warn('Binance unavailable, status:', res.status);
  } catch (e) {
    console.warn('Binance failed:', e);
  }

  // ── 3. CoinGecko simple price (no auth, no API key needed) ──────────────
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      { headers: { ...HEADERS, 'Accept': 'application/json' } }
    );
    const text = await res.text();
    if (res.ok) {
      const data = JSON.parse(text);
      const price = data?.bitcoin?.usd;
      if (price > 0) return price;
    }
    console.warn('CoinGecko responded', res.status);
  } catch (e) {
    console.warn('CoinGecko failed:', e);
  }

  throw new Error('All price sources failed');
}

const CRON_ITERATIONS = 30;
const CRON_INTERVAL_MS = 2000;

export async function runPriceFetcher(env: Env): Promise<void> {
  for (let i = 0; i < CRON_ITERATIONS; i++) {
    try {
      const price = await fetchBtcPrice();
      await setPriceInDb(env.DB, {
        usd: price,
        ts:  new Date().toISOString(),
      });
      // Uncomment for debugging: console.log(`[cron] iteration ${i}: $${price}`);
    } catch (e) {
      console.error(`Price fetch iteration ${i} failed:`, e);
    }

    if (i < CRON_ITERATIONS - 1) await new Promise(r => setTimeout(r, CRON_INTERVAL_MS));
  }
}
