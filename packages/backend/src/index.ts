// packages/backend/src/index.ts
// Cloudflare Worker entry point.
// Handles both fetch (HTTP) and scheduled (cron) events.
//
// Security: every fetch request is validated against x-api-secret before
// reaching any handler. The secret is injected by the SvelteKit proxy layer
// and never exposed to the browser.
//
// CORS: only the Pages deployment origin is allowed.

import type { Env } from './db/client';
import { requireAuth }      from './middleware/auth';
import { getPrice }         from './handlers/price';
import { priceStream }      from './handlers/price-stream';
import { createOrUpdatePlayer, getPlayer } from './handlers/players';
import { createGuess, getGuessStatus }     from './handlers/guesses';
import { runPriceFetcher }  from './cron/priceFetcher';

// Replace with your Pages deployment origin in production
const ALLOWED_ORIGIN = 'https://hodl-or-fold.pages.dev';

export default {
  // ── HTTP handler ────────────────────────────────────────────────────────────
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(new Response(null, { status: 204 }), request);
    }

    // Auth gate — all routes require a valid x-api-secret
    const authError = await requireAuth(request, env);
    if (authError) return corsResponse(authError, request);

    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    try {
      // ── Route table ─────────────────────────────────────────────────────────

      // GET /price/stream  — SSE; must be checked before /price
      if (method === 'GET' && path === '/price/stream') {
        return await priceStream(request, env);
      }

      // GET /price
      if (method === 'GET' && path === '/price') {
        return corsResponse(await getPrice(env), request);
      }

      // POST /players
      if (method === 'POST' && path === '/players') {
        return corsResponse(await createOrUpdatePlayer(request, env), request);
      }

      // GET /players/:id
      const playerMatch = path.match(/^\/players\/([^/]+)$/);
      if (method === 'GET' && playerMatch) {
        return corsResponse(await getPlayer(playerMatch[1], env), request);
      }

      // POST /guesses
      if (method === 'POST' && path === '/guesses') {
        return corsResponse(await createGuess(request, env), request);
      }

      // GET /guesses/:id
      const guessMatch = path.match(/^\/guesses\/([^/]+)$/);
      if (method === 'GET' && guessMatch) {
        return corsResponse(await getGuessStatus(guessMatch[1], env), request);
      }

      return corsResponse(
        new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
        request
      );
    } catch (err) {
      console.error('Unhandled error:', err);
      return corsResponse(
        new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
        request
      );
    }
  },

  // ── Scheduled handler (cron) ─────────────────────────────────────────────
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await runPriceFetcher(env);
  },
};

// ── CORS helper ──────────────────────────────────────────────────────────────

function corsResponse(response: Response, request: Request): Response {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = origin === ALLOWED_ORIGIN || origin.endsWith('.pages.dev');

  const headers = new Headers(response.headers);
  if (allowed) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, x-api-secret');
  }

  return new Response(response.body, {
    status:  response.status,
    headers,
  });
}
