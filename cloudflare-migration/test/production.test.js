import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionWorker } from '../src/production.js';

const credentials = { PRODUCTION_MODE: 'true', ENABLE_LINE: 'true', DATABASE_URL: 'production-only', LINE_CHANNEL_SECRET: 'prod-secret', LINE_CHANNEL_ACCESS_TOKEN: 'prod-token' };
test('production cannot run with staging credentials or incomplete production configuration', async () => {
  let calls = 0;
  const worker = createProductionWorker({worker: {fetch() { calls++; }}});
  for (const missing of ['PRODUCTION_MODE', 'ENABLE_LINE', 'DATABASE_URL', 'LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN']) {
    const env = {...credentials, STAGING_MODE:'true', STAGING_DATABASE_URL:'staging-only', ENABLE_STAGING_LINE:'true'};
    delete env[missing];
    assert.equal((await worker.fetch(new Request('https://bot.test/callback', {method:'POST'}),env)).status,503);
  }
  assert.equal(calls,0);
});
test('production adapter uses production database and blocks reminder and Discord settings', async () => {
  let received;
  const worker = createProductionWorker({worker: {fetch(_request,env) { received=env; return new Response('ok'); }}});
  await worker.fetch(new Request('https://bot.test/callback', {method:'POST'}), {...credentials, ENABLE_ADMIN:'true', ADMIN_PASSWORD:'prod-admin', STAGING_DATABASE_URL:'wrong', ENABLE_STAGING_REMINDERS:'true', STAGING_REMINDER_API_KEY:'never-forward', ENABLE_STAGING_DISCORD:'true'});
  assert.equal(received.STAGING_DATABASE_URL,'production-only');
  assert.equal(received.ENABLE_STAGING_ADMIN,'true');
  assert.equal(received.ADMIN_PASSWORD,'prod-admin');
  assert.equal(received.ENABLE_STAGING_REMINDERS,'false');
  assert.equal(received.ENABLE_STAGING_DISCORD,'false');
  assert.equal(received.STAGING_REMINDER_API_KEY,undefined);
  assert.equal((await worker.fetch(new Request('https://bot.test/discord/interactions',{method:'POST'}),credentials)).status,404);
  const health=await (await worker.fetch(new Request('https://bot.test/'),credentials)).json();
  assert.equal(health.mode,'production');
  assert.equal(health.reminders_enabled,false);
});
