// packages/frontend/src/routes/api/price/stream/+server.ts
// Proxy: GET /api/price/stream → Worker GET /price/stream (SSE)
//
// SSE requires the response body to stream — fetch() by default buffers the
// response. Using the raw body passthrough ensures the browser receives
// individual SSE events as the Worker writes them.

import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export const GET: RequestHandler = async (event) => {
  const workerUrl = `${env.WORKER_URL}/price/stream`;

  const upstream = await fetch(workerUrl, {
    headers: {
      'x-api-secret': env.API_SECRET,
      'Accept':        'text/event-stream',
    },
    // @ts-expect-error — needed in some runtimes to prevent buffering
    duplex: 'half',
  });

  // Pass through the streaming body directly — do not buffer
  return new Response(upstream.body, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  });
};
