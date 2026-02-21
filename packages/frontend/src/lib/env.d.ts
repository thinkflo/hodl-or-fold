// src/lib/env.d.ts
// Type shim for $env/dynamic/private until SvelteKit generates its own.
declare module '$env/dynamic/private' {
  export const env: {
    WORKER_URL: string;
    API_SECRET: string;
    [key: string]: string;
  };
}
