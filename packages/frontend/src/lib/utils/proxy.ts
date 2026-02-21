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

  return fetch(workerUrl, {
    method:  event.request.method,
    headers,
    body:    event.request.method !== 'GET' && event.request.method !== 'HEAD'
               ? event.request.body
               : undefined,
  });
}
