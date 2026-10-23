import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {validateReceipt,cleanEvents,INDEX_SQL} from '../scripts/retention-core.mjs';
import {expiredEvent,MAX_EVENT_AGE_MS} from '../src/retention-policy.js';
import {warningsFor} from '../scripts/maintain-d1.mjs';
import {createEventStore} from '../src/events.js';
const now=Date.parse('2026-10-17T00:00:00Z');
const ago=days=>new Date(now-days*86400000).toISOString();
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../d1/0001_core.sql',import.meta.url),'utf8'));
 for(const sql of INDEX_SQL)db.exec(sql);
 const rows=[['expired',ago(15),'{"type":"text","text":"old"}'],['compact',ago(2),'{"type":"text","text":"large"}'],['fresh',ago(.5),'{"type":"text","text":"keep"}'],['pending',null,null],['failed',null,'{"type":"text","text":"retry"}']];
 for(const [id,delivered,reply] of rows)db.prepare('INSERT INTO staging_line_events(event_id,delivered_at,reply,created_at) VALUES(?,?,?,?)').run(id,delivered,reply,ago(20));
 db.exec("INSERT INTO boss_types VALUES('h','王',60);INSERT INTO boss_kills(chat_id,boss_key,boss_name,kill_time,respawn_time) VALUES('g','h','王','2026-10-17T00:00:00.000Z','2026-10-17T01:00:00.000Z');INSERT INTO chat_settings VALUES('g',1);");
 const query=async(sql,params=[])=>{const result=db.prepare(sql).run(...params);return {success:true,meta:{changes:result.changes,rows_written:result.changes*(sql.startsWith('DELETE')?4:2)}};};
 return {db,query};
}
test('cleanup removes only old delivered metadata, compacts completed replies, preserves pending and boss data',async()=>{
 const {db,query}=fixture();try{
 const before=db.prepare('SELECT * FROM boss_kills').all();
 const result=await cleanEvents(query,{now,batchSize:1});assert.equal(result.deleted,1);assert.equal(result.compacted,1);
 assert.equal(db.prepare("SELECT count(*) n FROM staging_line_events WHERE event_id='expired'").get().n,0);
 assert.equal(db.prepare("SELECT reply FROM staging_line_events WHERE event_id='compact'").get().reply,null);
 assert.equal(db.prepare("SELECT reply FROM staging_line_events WHERE event_id='fresh'").get().reply.includes('keep'),true);
 assert.equal(db.prepare("SELECT reply FROM staging_line_events WHERE event_id='failed'").get().reply.includes('retry'),true);
 assert.equal(db.prepare("SELECT count(*) n FROM staging_line_events WHERE event_id='pending'").get().n,1);
 assert.deepEqual(db.prepare('SELECT * FROM boss_kills').all(),before);
 assert.equal(db.prepare('SELECT count(*) n FROM boss_types').get().n,1);
 assert.equal(db.prepare('SELECT half_mode FROM chat_settings').get().half_mode,1);
 const env={DATABASE_BACKEND:'d1',BOSS_DB:{prepare(sql){return {bind(...params){return {async all(){return {success:true,results:db.prepare(sql).all(...params)};}};}};}}};
 assert.equal((await createEventStore(env).claim('compact')).state,'done');
 const second=await cleanEvents(query,{now});assert.equal(second.deleted,0);assert.equal(second.compacted,0);
 }finally{db.close();}
});
test('cleanup stops at write budget and never runs an unbounded deletion',async()=>{
 const {db,query}=fixture();try{const result=await cleanEvents(query,{now,writeBudget:4,batchSize:250});assert.equal(result.deleted,1);assert.equal(result.compacted,0);assert.equal(result.budgetExhausted,true);assert.equal(result.writes,4);}finally{db.close();}
});
test('cleanup requires a recent matching verified backup receipt',()=>{
 const receipt={databaseId:'db',key:'d1-production/daily/file.sql',verified:true,sha256:'a'.repeat(64),verifiedAt:new Date(now).toISOString()};
 const options={databaseId:'db',prefix:'d1-production/daily/',now};
 assert.doesNotThrow(()=>validateReceipt(receipt,options));
 for(const bad of [null,{...receipt,verified:false},{...receipt,databaseId:'wrong'},{...receipt,key:'d1-staging/daily/file.sql'},{...receipt,verifiedAt:ago(1)},{...receipt,sha256:'bad'}])assert.throws(()=>validateReceipt(bad,options));
});
test('old signed LINE events cannot replay after their delivered record is pruned',()=>{
 assert.equal(expiredEvent({timestamp:now-MAX_EVENT_AGE_MS-1},now),true);
 assert.equal(expiredEvent({timestamp:now-MAX_EVENT_AGE_MS+1},now),false);
 assert.equal(expiredEvent({timestamp:now},now),false);
});
test('capacity and failures warn at thresholds; healthy results do not warn',()=>{
 assert.deepEqual(warningsFor({size:100000,reads:100,writes:100,backupStatus:'success',cleanupStatus:'success'}),[]);
 assert.equal(warningsFor({size:250*1024*1024,reads:2500000,writes:50000}).length,3);
 assert.equal(warningsFor({size:0,reads:0,writes:0,backupStatus:'failure',cleanupStatus:'skipped',budgetExhausted:true}).length,3);
});
