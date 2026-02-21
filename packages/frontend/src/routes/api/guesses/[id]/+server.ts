// packages/frontend/src/routes/api/guesses/[id]/+server.ts
// Proxy: GET /api/guesses/:id → Worker GET /guesses/:id
import type { RequestHandler } from '@sveltejs/kit';
import { proxyToWorker } from '$lib/utils/proxy';
import { env } from '$env/dynamic/private';

export const GET: RequestHandler = (event) =>
  proxyToWorker(event, { WORKER_URL: env.WORKER_URL, API_SECRET: env.API_SECRET });
