// packages/shared/src/index.ts
// Canonical types shared between frontend and backend.
// Keep this file free of runtime dependencies — types only.

export type Direction  = 'up' | 'down';
export type GuessStatus  = 'pending' | 'resolved';
export type GuessOutcome = 'correct' | 'wrong';
export type PendingReason = 'timer' | 'awaiting_price_change' | 'price_unavailable';

// ── Database row shapes ──────────────────────────────────────────────────────

export interface Player {
  id: string;
  score: number;
  last_seen: string;
  created_at: string;
}

export interface Guess {
  id: string;
  player_id: string;
  direction: Direction;
  price_at_guess: number;
  guessed_at: string;
  resolved_at: string | null;
  price_at_resolve: number | null;
  outcome: GuessOutcome | null;
  status: GuessStatus;
}

// ── Price feed ───────────────────────────────────────────────────────────────

export interface PricePayload {
  usd: number;
  ts: string; // ISO timestamp from cron
}

// ── API response shapes ──────────────────────────────────────────────────────

/** Response from POST /players and GET /players/:id */
export interface PlayerResponse {
  id: string;
  score: number;
  pendingGuess: Guess | null;
}

/** Response from POST /guesses */
export interface CreateGuessResponse {
  id: string;
  priceAtGuess: number;
  guessedAt: string;
}

/**
 * Response from GET /guesses/:id.
 * Always reflects current resolution status.
 * Fields are null when not applicable to the current status.
 */
export interface GuessStatusResponse {
  id: string;
  status: GuessStatus;
  outcome: GuessOutcome | null;
  score: number | null;         // player's updated total score; set only when resolved
  currentPrice: number | null;  // price at moment of resolution; set only when resolved
  reason: PendingReason | null; // why still pending; set only when pending
  secondsLeft: number | null;   // seconds until timer expires; set only when reason === 'timer'
}
