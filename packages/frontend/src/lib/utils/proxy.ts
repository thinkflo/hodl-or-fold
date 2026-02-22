// packages/frontend/src/lib/utils/proxy.ts
// Shared proxy utility for all /api/* server routes.
// Forwards the request to the Cloudflare Worker, injecting x-api-secret
// from the Pages environment variable. The secret is never sent to the browser.

import type { RequestEvent } from '@sveltejs/kit';

interface Env {
  WORKER_URL:  string;
  API_SECRET:  string;
}

/**
 * Proxies a SvelteKit request to the backend Worker.
 * Strips the /api prefix from the path before forwarding.
 */
export async function proxyToWorker(
  event: RequestEvent,
  env: Env
): Promise<Response> {
  const path        = event.url.pathname.replace(/^\/api/, '');
  const workerUrl   = `${env.WORKER_URL}${path}${event.url.search}`;

  const headers = new Headers(event.request.headers);
  headers.set('x-api-secret', env.API_SECRET);
  headers.delete('host'); // prevent host mismatch at the Worker

  const hasBody = event.request.method !== 'GET' && event.request.method !== 'HEAD';
  try {
    const res = await fetch(workerUrl, {
      method:  event.request.method,
      headers,
      body:    hasBody ? event.request.body : undefined,
      // Required by Node (undici) when sending a streaming body (local dev only)
      ...(hasBody && { duplex: 'half' } as RequestInit),
    });
    // Re-body the response so encoding headers match. Upstream (Worker/CF) may send
    // Content-Encoding: gzip/br; passing that through causes ERR_CONTENT_DECODING_FAILED.
    const body = await res.arrayBuffer();
    const outHeaders = new Headers(res.headers);
    outHeaders.delete('content-encoding');
    outHeaders.delete('transfer-encoding');
    return new Response(body, { status: res.status, headers: outHeaders });
  } catch (err) {
    console.error('[proxy] upstream fetch failed:', err);
    return new Response(
      JSON.stringify({
        error: 'Backend unreachable',
        hint:  'Check WORKER_URL and API_SECRET in .env; ensure backend is running or deployed.',
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
