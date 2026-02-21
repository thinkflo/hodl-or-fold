-- 001_initial.sql
-- Run with: wrangler d1 execute hodl-or-fold-db --file=packages/backend/src/db/migrations/001_initial.sql

CREATE TABLE players (
  id          TEXT    PRIMARY KEY,
  score       INTEGER NOT NULL DEFAULT 0,
  last_seen   TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE guesses (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  player_id        TEXT NOT NULL REFERENCES players(id),
  direction        TEXT NOT NULL CHECK (direction IN ('up', 'down')),
  price_at_guess   REAL NOT NULL,
  guessed_at       TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at      TEXT,
  price_at_resolve REAL,
  outcome          TEXT CHECK (outcome IN ('correct', 'wrong')),
  status           TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'resolved'))
);

-- Used by GET /players/:id to efficiently find any in-flight guess
CREATE INDEX idx_guesses_player_status ON guesses(player_id, status);
