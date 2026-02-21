// packages/backend/src/middleware/auth.ts
// Rejects requests missing or presenting an invalid x-api-secret header.
// The secret is compared using constant-time logic via crypto.subtle to
// prevent timing attacks.
//
// The browser never calls the Worker directly — SvelteKit server routes
// proxy all requests and inject the secret from a Pages environment variable.
// This header is never exposed to the client.

import type { Env } from '../db/client';

export async function requireAuth(request: Request, env: Env): Promise<Response | null> {
  const provided = request.headers.get('x-api-secret') ?? '';

  // crypto.subtle.timingSafeEqual is not available in Workers; simulate
  // constant-time comparison by hashing both values.
  const [providedHash, expectedHash] = await Promise.all([
    digest(provided),
    digest(env.API_SECRET),
  ]);

  if (providedHash !== expectedHash) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null; // auth passed
}

async function digest(value: string): Promise<string> {
  const data   = new TextEncoder().encode(value);
  const hash   = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
