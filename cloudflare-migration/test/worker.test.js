import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { formatDiscordKb } from '../src/index.js';

test('health is staging', async () => {
  const r = await worker.fetch(new Request('https://staging.example/'), {});
  assert.equal(r.status, 200);
  assert.equal((await r.json()).mode, 'staging');
});

test('reject unsigned LINE webhook', async () => {
  const r = await worker.fetch(new Request('https://staging.example/callback', {method:'POST',body:'{}'}), {});
  assert.equal(r.status, 401);
});

test('reject unsigned Discord webhook when explicitly enabled', async () => {
  const r = await worker.fetch(new Request('https://staging.example/discord/interactions', {method:'POST',body:'{}'}), {STAGING_MODE:'true',ENABLE_STAGING_DISCORD:'true'});
  assert.equal(r.status, 401);
});

test('empty KB', () => assert.match(formatDiscordKb([]), /沒有 BOSS 紀錄/));

test('Discord webhook requires explicit staging enablement', async () => {
 const r=await worker.fetch(new Request('https://staging.example/discord/interactions',{method:'POST',body:'{}'}),{STAGING_MODE:'true'});
 assert.equal(r.status,503);
});
test('staging health flags remain false by default', async () => {
 const r=await worker.fetch(new Request('https://staging.example/'),{});
 const health=await r.json();
 assert.equal(health.line_enabled,false);
 assert.equal(health.admin_enabled,false);
 assert.equal(health.reminders_enabled,false);
});
