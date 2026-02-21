-- 002_price_feed.sql
-- Single row for live BTC price (replaces KV for real-time consistency with D1).
-- Run: wrangler d1 execute hodl-or-fold-db --remote --file=packages/backend/src/db/migrations/002_price_feed.sql

CREATE TABLE price_feed (
  k   TEXT PRIMARY KEY,
  usd REAL NOT NULL,
  ts  TEXT NOT NULL
);

INSERT INTO price_feed (k, usd, ts) VALUES ('btc', 0, '');
