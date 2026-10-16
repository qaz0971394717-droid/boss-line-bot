import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createSql, hasDatabase } from '../src/database.js';
import { createEventStore } from '../src/events.js';
import { handleLineCommand } from '../src/line-commands.js';

function fixture() {
 const db = new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('../d1/0001_core.sql', import.meta.url),'utf8'));
 const env={STAGING_MODE:'true', ENABLE_STAGING_ADMIN:'true', ADMIN_PASSWORD:'secret', DATABASE_BACKEND:'d1',BOSS_DB:{prepare(query){return {bind(...params){return {async all(){return {success:true,results:db.prepare(query).all(...params)};}};}};}}};
 return {db,env};
}

test('D1 commands preserve group isolation, time, half mode and admin changes',async()=>{
 const {db,env}=fixture();
 try {
 const sql=createSql(env);
 await sql`INSERT INTO boss_types(boss_key,boss_name,minutes) VALUES(${'大象h'},${'大象H'},${120})`;
 const now=new Date('2026-10-17T00:00:00Z');
 assert.match((await handleLineCommand('HALF ON','a',env,now)).text,/HALF/);
 assert.match((await handleLineCommand('K 大象H','a',env,now)).text,/09:00:00/);
 assert.equal(db.prepare('SELECT count(*) AS n FROM boss_kills').get().n,1);
 assert.match((await handleLineCommand('KB','b',env,now)).text,/沒有 BOSS/);
 assert.match((await handleLineCommand('測試','a',env,now)).text,/Cloudflare D1/);
 await handleLineCommand('修改王 大象H 180','a',env,now);
 await handleLineCommand('secret','a',env,now);
 assert.equal(db.prepare('SELECT minutes FROM boss_types').get().minutes,180);
 await handleLineCommand('取消 大象H','a',env,now);
 assert.equal(db.prepare('SELECT count(*) AS n FROM boss_kills').get().n,0);
 } finally {db.close();}
});

test('D1 durable event claims preserve ready/pending/delivered without replay',async()=>{
 const {db,env}=fixture();
 try {
 const store=createEventStore(env);
 assert.equal((await store.claim('one')).state,'new');
 assert.equal((await store.claim('one')).state,'pending');
 const reply={type:'text',text:'hello'};
 await store.complete('one',reply);
 assert.deepEqual(await store.claim('one'),{state:'ready',reply});
 await store.delivered('one');
 assert.equal((await store.claim('one')).state,'done');
 } finally {db.close();}
});

test('D1 uses bound values and cannot fall back to Neon on a missing binding',async()=>{
 const {db,env}=fixture();
 try {
 assert.equal(hasDatabase({DATABASE_BACKEND:'d1',STAGING_DATABASE_URL:'unused'}),false);
 assert.throws(()=>createSql({DATABASE_BACKEND:'d1',STAGING_DATABASE_URL:'unused'}),/binding missing/);
 const sql=createSql(env), hostile="x'); DROP TABLE boss_types; --";
 await sql`INSERT INTO boss_types(boss_key,boss_name,minutes) VALUES(${hostile},${hostile},${60})`;
 assert.equal(db.prepare('SELECT boss_key FROM boss_types').get().boss_key,hostile);
 } finally {db.close();}
});

import { convert } from '../scripts/convert-postgres-to-d1.mjs';
test('migration preserves IDs, UTC instants, groups, JSON replies and pending claims',()=>{
 const data={boss_types:[{boss_key:"王'一",boss_name:"王'一",minutes:60}],
 boss_kills:[{id:'12',chat_id:'g1',boss_key:"王'一",boss_name:"王'一",kill_time:'2026-10-17T08:00:00+08:00',respawn_time:'2026-10-17T09:00:00+08:00'}],
 chat_settings:[{chat_id:'g1',half_mode:true}],staging_admin_challenges:[],
 staging_line_events:[{event_id:'pending',reply:null,delivered_at:null,created_at:'2026-10-17T00:00:00Z'},{event_id:'ready',reply:{type:'text',text:"王'一"},delivered_at:null,created_at:'2026-10-17T00:00:00Z'}]};
 const {db}=fixture();
 try {
 const result=convert(data);db.exec(result.sql);
 assert.equal(db.prepare('SELECT id FROM boss_kills').get().id,12);
 assert.equal(db.prepare('SELECT kill_time FROM boss_kills').get().kill_time,'2026-10-17T00:00:00.000Z');
 assert.equal(db.prepare('SELECT half_mode FROM chat_settings').get().half_mode,1);
 assert.equal(db.prepare("SELECT reply FROM staging_line_events WHERE event_id='pending'").get().reply,null);
 assert.deepEqual(JSON.parse(db.prepare("SELECT reply FROM staging_line_events WHERE event_id='ready'").get().reply),{type:'text',text:"王'一"});
 assert.equal(result.manifest.boss_kills.rows,1);
 assert.throws(()=>db.exec(result.sql),/UNIQUE/);
 assert.throws(()=>convert({...data,boss_kills:[{...data.boss_kills[0],kill_time:'bad'}]}),/timestamp/);
 } finally {db.close();}
});
