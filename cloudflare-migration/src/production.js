import { createWorker } from './index.js';

// Reuse the verified command engine through an explicit configuration adapter.
// Never fall back to staging credentials or expose Discord/reminder routes.
export function createProductionWorker({ worker = createWorker() } = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const enabled = env.PRODUCTION_MODE === 'true' && env.ENABLE_LINE === 'true';
      if (url.pathname === '/' && request.method === 'GET') {
        return Response.json({ service: 'hit2-boss-production', mode: 'production', status: 'ok',
          line_enabled: enabled, admin_enabled: enabled && env.ENABLE_ADMIN === 'true', reminders_enabled: false });
      }
      if (url.pathname !== '/callback' || request.method !== 'POST') return new Response('Not Found', { status: 404 });
      if (!enabled || !env.DATABASE_URL || !env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN) {
        return Response.json({ error: 'Production LINE configuration incomplete' }, { status: 503 });
      }
      return worker.fetch(request, {
        STAGING_MODE: 'true',
        ENABLE_STAGING_LINE: 'true',
        STAGING_DATABASE_URL: env.DATABASE_URL,
        LINE_CHANNEL_SECRET: env.LINE_CHANNEL_SECRET,
        LINE_CHANNEL_ACCESS_TOKEN: env.LINE_CHANNEL_ACCESS_TOKEN,
        ENABLE_STAGING_ADMIN: env.ENABLE_ADMIN === 'true' ? 'true' : 'false',
        ADMIN_PASSWORD: env.ADMIN_PASSWORD,
        ENABLE_STAGING_REMINDERS: 'false',
        ENABLE_STAGING_DISCORD: 'false'
      });
    }
  };
}

export default createProductionWorker();
