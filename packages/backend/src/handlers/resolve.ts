// packages/backend/src/handlers/resolve.ts
// Core resolution logic for a pending guess.
//
// Two-condition resolution (spec §5.7):
//   1. At least 60 seconds have elapsed since guessed_at.
//   2. Current BTC price differs from price_at_guess.
// Both must be true simultaneously. Either alone is insufficient.
//
// Resolution reads D1 (price_feed) for the current price — it never calls
// Binance or CoinGecko directly. If no price, returns pending with reason
// 'price_unavailable'. The guess waits indefinitely until price moves.
//
// Idempotent: calling this on an already-resolved guess returns its
// existing outcome without mutating the database.

import type { Env } from '../db/client';
import type { Guess, GuessStatusResponse } from '@hodl-or-fold/shared';
import { getPriceFromDb } from '../db/price';

const ROUND_SECONDS = 60;

export async function tryResolve(guessId: string, env: Env): Promise<GuessStatusResponse> {
  const guess = await env.DB
    .prepare('SELECT * FROM guesses WHERE id = ?')
    .bind(guessId)
    .first<Guess>();

  if (!guess) {
    throw new Error(`Guess not found: ${guessId}`);
  }

  // Idempotent — already resolved
  if (guess.status === 'resolved') {
    const player = await env.DB
      .prepare('SELECT score FROM players WHERE id = ?')
      .bind(guess.player_id)
      .first<{ score: number }>();

    return {
      id:           guess.id,
      status:       'resolved',
      outcome:      guess.outcome,
      score:        player?.score ?? null,
      currentPrice: guess.price_at_resolve,
      reason:       null,
      secondsLeft:  null,
    };
  }

  // ── Condition 1: timer ───────────────────────────────────────────────────
  const secondsElapsed = Math.floor(
    (Date.now() - new Date(guess.guessed_at).getTime()) / 1000
  );

  if (secondsElapsed < ROUND_SECONDS) {
    return {
      id:           guess.id,
      status:       'pending',
      outcome:      null,
      score:        null,
      currentPrice: null,
      reason:       'timer',
      secondsLeft:  ROUND_SECONDS - secondsElapsed,
    };
  }

  // ── Condition 2: price must have moved ──────────────────────────────────
  const dbPrice = await getPriceFromDb(env.DB);

  if (!dbPrice) {
    return {
      id:           guess.id,
      status:       'pending',
      outcome:      null,
      score:        null,
      currentPrice: null,
      reason:       'price_unavailable',
      secondsLeft:  null,
    };
  }

  const currentPrice = dbPrice.usd;

  if (currentPrice === guess.price_at_guess) {
    return {
      id:           guess.id,
      status:       'pending',
      outcome:      null,
      score:        null,
      currentPrice: null,
      reason:       'awaiting_price_change',
      secondsLeft:  null,
    };
  }

  // ── Both conditions met — resolve ────────────────────────────────────────
  const correct =
    (guess.direction === 'up'   && currentPrice > guess.price_at_guess) ||
    (guess.direction === 'down' && currentPrice < guess.price_at_guess);

  const outcome    = correct ? 'correct' : 'wrong';
  const scoreDelta = correct ? 1 : -1;

  // Atomic updates — D1's single-threaded processing prevents race conditions
  await env.DB
    .prepare(`
      UPDATE guesses
      SET status = 'resolved', outcome = ?, price_at_resolve = ?, resolved_at = datetime('now')
      WHERE id = ?
    `)
    .bind(outcome, currentPrice, guessId)
    .run();

  await env.DB
    .prepare(`UPDATE players SET score = score + ?, last_seen = datetime('now') WHERE id = ?`)
    .bind(scoreDelta, guess.player_id)
    .run();

  const player = await env.DB
    .prepare('SELECT score FROM players WHERE id = ?')
    .bind(guess.player_id)
    .first<{ score: number }>();

  return {
    id:           guess.id,
    status:       'resolved',
    outcome,
    score:        player?.score ?? null,
    currentPrice,
    reason:       null,
    secondsLeft:  null,
  };
}
