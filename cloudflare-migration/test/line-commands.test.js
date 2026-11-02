import test from 'node:test';
import assert from 'node:assert/strict';
import {getChatId,parseKillTime,parseRespawnTime,taipeiTime} from '../src/line-commands.js';

test('group isolation identifier precedence',()=>{
  assert.equal(getChatId({groupId:'group',roomId:'room',userId:'user'}),'group');
  assert.equal(getChatId({roomId:'room',userId:'user'}),'room');
  assert.equal(getChatId({userId:'user'}),'user');
});
test('manual K time accepts 4 or 6 digits',()=>{
  assert.equal(taipeiTime(parseKillTime('1022',new Date('2026-10-16T12:00:00Z'))),'10/16 10:22:00');
  assert.equal(taipeiTime(parseKillTime('102233',new Date('2026-10-16T12:00:00Z'))),'10/16 10:22:33');
  assert.equal(parseKillTime('2460'),null);
});
test('manual K time later than now means yesterday',()=>{
  const now=new Date('2026-10-16T16:10:00Z'); // 10/17 00:10 Taipei
  assert.equal(taipeiTime(parseKillTime('2350',now)),'10/16 23:50:00');
  assert.equal(taipeiTime(parseKillTime('0005',now)),'10/17 00:05:00');
  assert.equal(taipeiTime(parseKillTime('001000',now)),'10/17 00:10:00');
});
test('manual respawn rejects invalid date',()=>{
  assert.equal(taipeiTime(parseRespawnTime('2026-10-16','14:30:25')),'10/16 14:30:25');
  assert.equal(parseRespawnTime('2026-02-30','14:30'),null);
});
