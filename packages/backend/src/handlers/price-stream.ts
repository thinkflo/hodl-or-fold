// packages/backend/src/handlers/price-stream.ts
// GET /price/stream — Server-Sent Events feed of live BTC/USD price.
//
// Each connected client gets its own independent stream. The Worker reads D1
// (price_feed) once per second and pushes the value down the connection.
// D1 gives read-after-write consistency so clients see updates within ~1s.
//
// Native EventSource in the browser auto-reconnects on drop; no client-side
// reconnect logic is required.
//
// If the DB read returns null, we skip that tick and emit nothing.

import type { Env } from '../db/client';
import type { PricePayload } from '@hodl-or-fold/shared';
import { getPriceFromDb } from '../db/price';

const POLL_INTERVAL_MS = 1000;

export async function priceStream(_request: Request, env: Env): Promise<Response> {
  const { readable, writable } = new TransformStream();
  const writer  = writable.getWriter();
  const encoder = new TextEncoder();

  // Pump runs independently; errors close the stream cleanly.
  pump(writer, encoder, env).catch(() => writer.close());

  return new Response(readable, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  });
}

async function pump(
  writer:  WritableStreamDefaultWriter,
  encoder: TextEncoder,
  env:     Env
): Promise<void> {
  while (true) {
    const cached = await getPriceFromDb(env.DB);

    if (cached) {
      await writer.write(
        encoder.encode(`data: ${JSON.stringify(cached)}\n\n`)
      );
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
