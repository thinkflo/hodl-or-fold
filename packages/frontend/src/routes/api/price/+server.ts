// packages/frontend/src/routes/api/price/+server.ts
// Proxy: GET /api/price → Worker GET /price (snapshot)
import type { RequestHandler } from '@sveltejs/kit';
import { proxyToWorker } from '$lib/utils/proxy';
import { env } from '$env/dynamic/private';

export const GET: RequestHandler = (event) =>
  proxyToWorker(event, { WORKER_URL: env.WORKER_URL, API_SECRET: env.API_SECRET });
