// packages/backend/src/handlers/resolve.test.ts
// Unit tests for guess resolution logic.
// Covers all cases from spec §9.1 and §9.3.

import { describe, it, expect, vi } from 'vitest';
import { tryResolve } from './resolve';
import type { Env } from '../db/client';
import type { Guess } from '@hodl-or-fold/shared';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ENTRY_PRICE = 94230;

function makeGuess(overrides: Partial<Guess> = {}): Guess {
  return {
    id:               'test-guess-id',
    player_id:        'test-player-id',
    direction:        'up',
    price_at_guess:   ENTRY_PRICE,
    guessed_at:       new Date(Date.now() - 61_000).toISOString(), // 61s ago by default
    resolved_at:      null,
    price_at_resolve: null,
    outcome:          null,
    status:           'pending',
    ...overrides,
  };
}

function makeEnv(guess: Guess | null, currentPrice: number | null, score = 0): Env {
  return {
    DB: {
      prepare: vi.fn().mockImplementation((sql: string) => ({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(
            sql.includes('price_feed')
              ? currentPrice !== null
                ? { usd: currentPrice, ts: new Date().toISOString() }
                : null
              : sql.includes('guesses') && !sql.includes('UPDATE')
                ? guess
                : { score }
          ),
          run: vi.fn().mockResolvedValue(undefined),
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
      })),
    },
    API_SECRET: 'test',
    MAX_PLAYERS: '100',
  } as unknown as Env;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('tryResolve', () => {
  describe('Condition 1 — timer not yet elapsed', () => {
    it('returns pending with reason "timer" and secondsLeft when < 60s elapsed', async () => {
      const guess = makeGuess({
        guessed_at: new Date(Date.now() - 30_000).toISOString(), // 30s ago
      });
      const env = makeEnv(guess, ENTRY_PRICE + 100);

      const result = await tryResolve('test-guess-id', env);

      expect(result.status).toBe('pending');
      expect(result.reason).toBe('timer');
      expect(result.secondsLeft).toBeGreaterThan(0);
      expect(result.secondsLeft).toBeLessThanOrEqual(30);
    });
  });

  describe('Condition 2 — price has not moved', () => {
    it('returns pending with reason "awaiting_price_change" when price equals entry', async () => {
      const guess = makeGuess(); // 61s ago
      const env = makeEnv(guess, ENTRY_PRICE); // same price

      const result = await tryResolve('test-guess-id', env);

      expect(result.status).toBe('pending');
      expect(result.reason).toBe('awaiting_price_change');
    });
  });

  describe('Price unavailable', () => {
    it('returns pending with reason "price_unavailable" when DB has no price', async () => {
      const guess = makeGuess(); // 61s ago, timer done
      const env = makeEnv(guess, null); // KV empty

      const result = await tryResolve('test-guess-id', env);

      expect(result.status).toBe('pending');
      expect(result.reason).toBe('price_unavailable');
    });
  });

  describe('Correct resolution — both conditions met', () => {
    it('resolves correctly for HODL when price went up', async () => {
      const guess = makeGuess({ direction: 'up' });
      const env = makeEnv(guess, ENTRY_PRICE + 500, 0);

      const result = await tryResolve('test-guess-id', env);

      expect(result.status).toBe('resolved');
      expect(result.outcome).toBe('correct');
    });

    it('resolves correctly for FOLD when price went down', async () => {
      const guess = makeGuess({ direction: 'down' });
      const env = makeEnv(guess, ENTRY_PRICE - 500, 0);

      const result = await tryResolve('test-guess-id', env);

      expect(result.status).toBe('resolved');
      expect(result.outcome).toBe('correct');
    });
  });

  describe('Wrong resolution — both conditions met', () => {
    it('resolves as wrong for HODL when price went down', async () => {
      const guess = makeGuess({ direction: 'up' });
      const env = makeEnv(guess, ENTRY_PRICE - 500, 0);

      const result = await tryResolve('test-guess-id', env);

      expect(result.status).toBe('resolved');
      expect(result.outcome).toBe('wrong');
    });

    it('resolves as wrong for FOLD when price went up', async () => {
      const guess = makeGuess({ direction: 'down' });
      const env = makeEnv(guess, ENTRY_PRICE + 500, 0);

      const result = await tryResolve('test-guess-id', env);

      expect(result.status).toBe('resolved');
      expect(result.outcome).toBe('wrong');
    });
  });

  describe('Idempotency — already resolved guess', () => {
    it('returns existing outcome without modifying the database', async () => {
      const resolved: Guess = makeGuess({
        status:           'resolved',
        outcome:          'correct',
        price_at_resolve: ENTRY_PRICE + 200,
        resolved_at:      new Date().toISOString(),
      });
      const env = makeEnv(resolved, ENTRY_PRICE + 200, 1);

      const result = await tryResolve('test-guess-id', env);

      expect(result.status).toBe('resolved');
      expect(result.outcome).toBe('correct');
      // DB.prepare should only be called for read, not write
      const runCalls = (env.DB.prepare as ReturnType<typeof vi.fn>).mock.calls
        .filter(([sql]: [string]) => sql.includes('UPDATE'));
      expect(runCalls.length).toBe(0);
    });
  });
});
