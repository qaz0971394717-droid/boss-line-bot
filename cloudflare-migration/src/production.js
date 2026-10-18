import { migrationGate } from './migration.js';
import { createWorker } from './index.js';

// Reuse the verified command engine through an explicit configuration adapter.
// Never fall back to staging credentials or expose Discord/reminder routes.
export function createProductionWorker({ worker = createWorker(), migrationHandler = migrationGate } = {}) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const enabled = env.PRODUCTION_MODE === 'true' && env.ENABLE_LINE === 'true';
      const maintenance = await migrationHandler(request, {MIGRATION_MODE: env.MIGRATION_MODE, MIGRATION_KEY: env.MIGRATION_KEY, STAGING_DATABASE_URL: env.DATABASE_URL});
      if (maintenance) return maintenance;
      if (url.pathname === '/' && request.method === 'GET') {
        return Response.json({ service: 'hit2-boss-production', mode: 'production', database_backend: env.DATABASE_BACKEND === 'd1' ? 'd1' : 'neon', status: 'ok',
          line_enabled: enabled, admin_enabled: enabled && env.ENABLE_ADMIN === 'true', reminders_enabled: false,
          line_reminders_enabled: false, discord_reminders_enabled: enabled && env.ENABLE_DISCORD_REMINDERS === 'true' && Boolean(env.DISCORD_REMINDER?.get) });
      }
      if (url.pathname !== '/callback' || request.method !== 'POST') return new Response('Not Found', { status: 404 });
      if (!enabled || !(env.DATABASE_BACKEND === 'd1' ? env.BOSS_DB?.prepare : env.DATABASE_URL) || !env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN) {
        return Response.json({ error: 'Production LINE configuration incomplete' }, { status: 503 });
      }
      return worker.fetch(request, {
        STAGING_MODE: 'true',
        PRODUCTION_MODE: 'true',
        ENABLE_DISCORD_REMINDERS: env.ENABLE_DISCORD_REMINDERS,
        DISCORD_REMINDER: env.DISCORD_REMINDER,
        ENABLE_BIRTHDAY_SURPRISE: env.ENABLE_BIRTHDAY_SURPRISE,
        DATABASE_BACKEND: env.DATABASE_BACKEND,
        ENABLE_UNDO: env.ENABLE_UNDO,
        ENABLE_OVERWRITE_GUARD: env.ENABLE_OVERWRITE_GUARD,
        ENABLE_UNDO_BUTTON: env.ENABLE_UNDO_BUTTON,
        ENABLE_EVENT_ORDER_GUARD: env.ENABLE_EVENT_ORDER_GUARD,
        BOSS_DB: env.DATABASE_BACKEND === 'd1' ? env.BOSS_DB : undefined,
        ENABLE_STAGING_LINE: 'true',
        STAGING_DATABASE_URL: env.DATABASE_URL,
        LINE_CHANNEL_SECRET: env.LINE_CHANNEL_SECRET,
        LINE_CHANNEL_ACCESS_TOKEN: env.LINE_CHANNEL_ACCESS_TOKEN,
        ENABLE_STAGING_ADMIN: env.ENABLE_ADMIN === 'true' ? 'true' : 'false',
        ADMIN_PASSWORD: env.ADMIN_PASSWORD,
        ENABLE_STAGING_REMINDERS: 'false',
        ENABLE_STAGING_DISCORD: 'false'
      }, ctx);
    }
  };
}

export default createProductionWorker();
