import type { Env } from '../db/client';
import type { Guess, PlayerResponse } from '@hodl-or-fold/shared';

const ACTIVE_WINDOW_HOURS = 24;

export async function createOrUpdatePlayer(
  request: Request,
  env: Env
): Promise<Response> {
  const { id } = await request.json<{ id: string }>();

  if (!id || typeof id !== 'string') {
    return jsonError('Missing or invalid player id', 400);
  }

  const maxPlayers = parseInt(env.MAX_PLAYERS ?? '100', 10);
  const cutoff     = new Date(Date.now() - ACTIVE_WINDOW_HOURS * 3600 * 1000).toISOString();

  const { results: activeRows } = await env.DB
    .prepare('SELECT COUNT(*) AS count FROM players WHERE last_seen > ? AND id != ?')
    .bind(cutoff, id)
    .all<{ count: number }>();

  const activeCount = activeRows[0]?.count ?? 0;

  if (activeCount >= maxPlayers) {
    return jsonError('Game is at capacity', 503, { full: true, activeUsers: activeCount, maxUsers: maxPlayers });
  }

  // Upsert player
  await env.DB
    .prepare(`
      INSERT INTO players (id, score, last_seen, created_at)
      VALUES (?, 0, datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET last_seen = datetime('now')
    `)
    .bind(id)
    .run();

  const player = await env.DB
    .prepare('SELECT id, score FROM players WHERE id = ?')
    .bind(id)
    .first<{ id: string; score: number }>();

  // Return any in-flight guess so client can restore state on refresh
  const pendingGuess = await env.DB
    .prepare("SELECT * FROM guesses WHERE player_id = ? AND status = 'pending' LIMIT 1")
    .bind(id)
    .first<Guess>();

  return json({ id: player!.id, score: player!.score, pendingGuess: pendingGuess ?? null } satisfies PlayerResponse);
}

export async function getPlayer(id: string, env: Env): Promise<Response> {
  await env.DB
    .prepare("UPDATE players SET last_seen = datetime('now') WHERE id = ?")
    .bind(id)
    .run();

  const player = await env.DB
    .prepare('SELECT id, score FROM players WHERE id = ?')
    .bind(id)
    .first<{ id: string; score: number }>();

  if (!player) {
    await env.DB
      .prepare("INSERT INTO players (id) VALUES (?)")
      .bind(id)
      .run();
    return json({ id, score: 0, pendingGuess: null } satisfies PlayerResponse);
  }

  const pendingGuess = await env.DB
    .prepare("SELECT * FROM guesses WHERE player_id = ? AND status = 'pending' LIMIT 1")
    .bind(id)
    .first<Guess>();

  return json({ id: player.id, score: player.score, pendingGuess: pendingGuess ?? null } satisfies PlayerResponse);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>): Response {
  return json({ error: message, ...extra }, status);
}
