// packages/frontend/src/lib/stores/game.ts
// Spec §5.4, §5.7, §1.1
//
// Single source of truth for all game state.
// The SSE price feed runs continuously from page load — always live, no idle simulator.
// Resolution is triggered client-side only to gate the API call; server is sole authority.

import { writable, derived, get } from 'svelte/store';
import type {
  Direction, GuessOutcome, PricePayload,
  PlayerResponse, CreateGuessResponse, GuessStatusResponse, Guess,
} from '@hodl-or-fold/shared';

// ── Phase ─────────────────────────────────────────────────────────────────────
export type Phase = 'idle' | 'guessing' | 'waiting' | 'validating' | 'resolved';

export interface Resolution {
  outcome:    GuessOutcome;
  direction:  Direction;
  entryPrice: number;
  finalPrice: number;
  scoreDelta: number;
}

interface PendingGuess {
  id:           string;
  direction:    Direction;
  priceAtGuess: number;
  guessedAt:    number; // ms epoch
}

// ── Atoms ─────────────────────────────────────────────────────────────────────
export const playerId    = writable<string>('');
export const score       = writable<number>(0);
export const price       = writable<number>(0);     // always live from SSE
export const phase       = writable<Phase>('idle');
export const secondsLeft = writable<number>(60);
export const direction   = writable<Direction | null>(null);
export const entryPrice  = writable<number>(0);
export const resolution  = writable<Resolution | null>(null);
export const isFull      = writable<boolean>(false);
/** Round start time (ms epoch) when in guessing/waiting; 0 otherwise. Used by chart for elapsed after refresh. */
export const roundStartMs = writable<number>(0);

// ── Derived ───────────────────────────────────────────────────────────────────
export const priceDelta = derived(
  [price, entryPrice, phase],
  ([$price, $entry, $phase]) => $phase !== 'idle' ? $price - $entry : 0
);

// Any price move (≥1¢) counts for winning/losing; round delta to avoid float noise
const STANDING_THRESHOLD = 0.01;
export const standing = derived(
  [priceDelta, direction, phase],
  ([$delta, $dir, $phase]): 'winning' | 'losing' | 'neutral' => {
    if ($phase === 'idle' || $phase === 'resolved') return 'neutral';
    const d = Math.round($delta * 100) / 100;
    if (d >= STANDING_THRESHOLD) return $dir === 'up'   ? 'winning' : 'losing';
    if (d <= -STANDING_THRESHOLD) return $dir === 'down' ? 'winning' : 'losing';
    return 'neutral';
  }
);

// ── Private mutable ───────────────────────────────────────────────────────────
let pendingGuess:   PendingGuess | null = null;
let eventSource:    EventSource  | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;

// ── SSE price feed — opened once at startup, runs for the lifetime of the page ──
// Spec §5.4: EventSource auto-reconnects on error — no manual handler needed.
export function connectPriceFeed(): () => void {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  eventSource = new EventSource('/api/price/stream');

  eventSource.onmessage = (event: MessageEvent) => {
    const payload: PricePayload = JSON.parse(event.data);
    price.set(payload.usd);
    checkResolution(payload.usd);
  };

  eventSource.onerror = () => {
    console.warn('[price feed] SSE dropped — browser will auto-reconnect');
  };

  return () => {
    eventSource?.close();
    eventSource = null;
  };
}

// ── Init ──────────────────────────────────────────────────────────────────────
// Called once from +page.svelte onMount with data from the server load function.
// connectPriceFeed() is called separately in onMount — not here.
export function initGame(serverData: PlayerResponse): void {
  playerId.set(serverData.id);
  score.set(serverData.score);

  if (serverData.pendingGuess) {
    restoreGuess(serverData.pendingGuess);
  }
}

// Parse server timestamp as UTC (D1/SQLite datetime('now') is UTC but has no 'Z')
function parseGuessedAt(guessed_at: string): number {
  const s = guessed_at.trim();
  return new Date(s.endsWith('Z') ? s : s + 'Z').getTime();
}

// ── Session restore ───────────────────────────────────────────────────────────
// Spec §1.1: Players can close and reopen browser — score and pending guess persist.
function restoreGuess(guess: Guess): void {
  const guessedAt = parseGuessedAt(guess.guessed_at);
  const elapsed   = (Date.now() - guessedAt) / 1000;

  pendingGuess = {
    id:           guess.id,
    direction:    guess.direction,
    priceAtGuess: guess.price_at_guess,
    guessedAt,
  };

  roundStartMs.set(guessedAt);
  direction.set(guess.direction);
  entryPrice.set(guess.price_at_guess);

  if (elapsed >= 60) {
    // Timer already expired — go straight to waiting state
    phase.set('waiting');
    secondsLeft.set(0);
  } else {
    phase.set('guessing');
    const remaining = Math.max(0, Math.ceil(60 - elapsed));
    secondsLeft.set(remaining);
    startCountdown();
  }
}

// ── Game actions ──────────────────────────────────────────────────────────────
export async function submitGuess(dir: Direction): Promise<void> {
  const id = get(playerId);
  if (!id) throw new Error('No player id');

  const res = await fetch('/api/guesses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: id, direction: dir }),
  });

  if (!res.ok) {
    const err = await res.json() as { error: string };
    throw new Error(err.error ?? 'Failed to submit guess');
  }

  const data = await res.json() as CreateGuessResponse;

  const guessedAt = Date.now();
  pendingGuess = {
    id:           data.id,
    direction:    dir,
    priceAtGuess: data.priceAtGuess,
    guessedAt,
  };

  roundStartMs.set(guessedAt);
  direction.set(dir);
  entryPrice.set(data.priceAtGuess);
  resolution.set(null);
  phase.set('guessing');
  secondsLeft.set(60);

  startCountdown();
}

export function resetGame(): void {
  stopCountdown();
  pendingGuess = null;
  roundStartMs.set(0);
  phase.set('idle');
  direction.set(null);
  entryPrice.set(0);
  resolution.set(null);
  secondsLeft.set(60);
}

// ── Resolution ────────────────────────────────────────────────────────────────
// Spec §5.7: Called on every SSE tick. Only attempts server call when BOTH
// local conditions are met — timer expired AND price has moved.
// Server independently re-validates and is sole authority on outcome.
async function checkResolution(newPrice: number): Promise<void> {
  if (!pendingGuess) return;
  const $phase = get(phase);
  if ($phase === 'idle' || $phase === 'resolved') return;
  // 'validating' and 'waiting' both allow resolution check

  const elapsed    = (Date.now() - pendingGuess.guessedAt) / 1000;
  const timerDone  = elapsed >= 60;
  const priceMoved = newPrice !== pendingGuess.priceAtGuess;

  if (!timerDone || !priceMoved) return;

  const res  = await fetch(`/api/guesses/${pendingGuess.id}`);
  const data = await res.json() as GuessStatusResponse;

  if (data.status !== 'resolved') return;

  const entryP = pendingGuess.priceAtGuess;
  const dir    = pendingGuess.direction;

  pendingGuess = null;
  roundStartMs.set(0);
  stopCountdown();

  score.set(data.score ?? get(score));
  resolution.set({
    outcome:    data.outcome!,
    direction:  dir,
    entryPrice: entryP,
    finalPrice: data.currentPrice!,
    scoreDelta: data.outcome === 'correct' ? 1 : -1,
  });
  price.set(data.currentPrice!);
  phase.set('resolved');
}

// ── Countdown ─────────────────────────────────────────────────────────────────
// Derive seconds left from stored timestamp each tick so refresh restores accurately.
function startCountdown(): void {
  stopCountdown();
  countdownTimer = setInterval(() => {
    const g = pendingGuess;
    if (!g) return;
    const remaining = Math.max(0, Math.ceil(60 - (Date.now() - g.guessedAt) / 1000));
    secondsLeft.set(remaining);
    if (remaining <= 0) {
      stopCountdown();
      if (get(phase) === 'guessing') {
        const currentPrice = get(price);
        const entry = g.priceAtGuess;
        const priceMoved = entry !== undefined && currentPrice !== undefined
          && Math.abs(currentPrice - entry) >= 0.01;
        phase.set(priceMoved ? 'validating' : 'waiting');
      }
    }
  }, 1000);
}

function stopCountdown(): void {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}
