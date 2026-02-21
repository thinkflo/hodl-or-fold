// packages/frontend/src/routes/api/players/+server.ts
// Proxy: POST /api/players → Worker POST /players
import type { RequestHandler } from '@sveltejs/kit';
import { proxyToWorker } from '$lib/utils/proxy';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = (event) =>
  proxyToWorker(event, { WORKER_URL: env.WORKER_URL, API_SECRET: env.API_SECRET });
