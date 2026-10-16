import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { formatDiscordKb } from '../src/index.js';

test('health is staging', async () => {
  const r = await worker.fetch(new Request('https://staging.example/'), {});
  assert.equal(r.status, 200);
  assert.equal((await r.json()).mode, 'read-only');
});

test('reject unsigned LINE webhook', async () => {
  const r = await worker.fetch(new Request('https://staging.example/callback', {method:'POST',body:'{}'}), {});
  assert.equal(r.status, 401);
});

test('reject unsigned Discord webhook', async () => {
  const r = await worker.fetch(new Request('https://staging.example/discord/interactions', {method:'POST',body:'{}'}), {});
  assert.equal(r.status, 401);
});

test('empty KB', () => assert.match(formatDiscordKb([]), /沒有 BOSS 紀錄/));
