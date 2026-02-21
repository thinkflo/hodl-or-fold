// packages/frontend/src/routes/+page.ts
// Server load function — runs on first page load (SSR) and client-side navigations.
//
// Responsibilities:
//   1. Get or generate a player UUID from localStorage
//   2. POST /players to register/refresh the player (upsert)
//   3. Return the player's current score and any pending guess
//      so the UI can restore round state after a browser close/reopen
//
// The load function uses /api/* routes which are SvelteKit server functions
// that proxy requests to the Cloudflare Worker, injecting x-api-secret.

import { browser } from '$app/environment';
import type { PlayerResponse } from '$lib/types';

export const ssr = false; // localStorage is browser-only

export async function load({ fetch }): Promise<{
  player: PlayerResponse | null;
  isFull: boolean;
  activeUsers: number;
  maxUsers: number;
}> {
  if (!browser) {
    return { player: null, isFull: false, activeUsers: 0, maxUsers: 100 };
  }

  let playerId = localStorage.getItem('hodl:playerId');
  if (!playerId) {
    playerId = crypto.randomUUID();
    localStorage.setItem('hodl:playerId', playerId);
  }

  const res = await fetch('/api/players', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: playerId }),
  });

  if (res.status === 503) {
    const data = await res.json<{ activeUsers: number; maxUsers: number }>();
    return { player: null, isFull: true, activeUsers: data.activeUsers, maxUsers: data.maxUsers };
  }

  if (!res.ok) {
    console.error('Failed to register player');
    return { player: null, isFull: false, activeUsers: 0, maxUsers: 100 };
  }

  const player: PlayerResponse = await res.json();
  return { player, isFull: false, activeUsers: 0, maxUsers: 100 };
}
