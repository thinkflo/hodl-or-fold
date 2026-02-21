// packages/backend/src/handlers/guesses.ts
// POST /guesses  — submit a new HODL or FOLD guess
// GET  /guesses/:id — check resolution status of an existing guess
//
// Design notes:
// - The entry price is fetched server-side from D1 at the exact moment of
//   submission, ensuring the client cannot tamper with it.
// - POST returns 409 if the player already has a pending guess.
// - GET delegates to tryResolve(), which enforces the two-condition rule.

import type { Env } from '../db/client';
import type { CreateGuessResponse, Direction } from '@hodl-or-fold/shared';
import { getPriceFromDb } from '../db/price';
import { tryResolve } from './resolve';

export async function createGuess(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ playerId: string; direction: Direction }>();

  if (!body.playerId || !['up', 'down'].includes(body.direction)) {
    return jsonError('Invalid request body', 400);
  }

  // Reject if player already has an unresolved guess
  const existing = await env.DB
    .prepare("SELECT id FROM guesses WHERE player_id = ? AND status = 'pending' LIMIT 1")
    .bind(body.playerId)
    .first<{ id: string }>();

  if (existing) {
    return jsonError('Guess already in progress', 409, { existingGuessId: existing.id });
  }

  // Lock the entry price server-side from D1 — never trust the client's price
  const dbPrice = await getPriceFromDb(env.DB);

  if (!dbPrice) {
    return jsonError('Price unavailable — try again shortly', 503);
  }

  const { results } = await env.DB
    .prepare(`
      INSERT INTO guesses (player_id, direction, price_at_guess)
      VALUES (?, ?, ?)
      RETURNING id, guessed_at
    `)
    .bind(body.playerId, body.direction, dbPrice.usd)
    .all<{ id: string; guessed_at: string }>();

  const guess = results[0];

  return json(
    {
      id:           guess.id,
      priceAtGuess: dbPrice.usd,
      guessedAt:    guess.guessed_at,
    } satisfies CreateGuessResponse,
    201
  );
}

export async function getGuessStatus(guessId: string, env: Env): Promise<Response> {
  try {
    const result = await tryResolve(guessId, env);
    return json(result);
  } catch (err) {
    return jsonError('Guess not found', 404);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>): Response {
  return json({ error: message, ...extra }, status);
}
