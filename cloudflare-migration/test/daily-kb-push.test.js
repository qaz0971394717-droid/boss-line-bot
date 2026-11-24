import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {runDailyKbPush} from '../src/daily-kb-push.js';
import {GROUP_ACCESS_SCHEMA} from '../src/group-access.js';
import production from '../src/production.js';

const SLOT=new Date('2026-11-24T10:00:00Z'); // 18:00 Asia/Taipei
const G1='C'+'1'.repeat(32),G2='C'+'2'.repeat(32),G3='C'+'3'.repeat(32),G4='C'+'4'.repeat(32),G5='C'+'5'.repeat(32);
function setup(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE boss_kills(chat_id TEXT NOT NULL,boss_key TEXT NOT NULL,boss_name TEXT NOT NULL,kill_time TEXT,respawn_time TEXT,PRIMARY KEY(chat_id,boss_key));');
 for(const s of GROUP_ACCESS_SCHEMA)db.exec(s);
 const BOSS_DB={prepare(q){return {bind(...a){return {async all(){return {success:true,results:db.prepare(q).all(...a)}}}}}}};
 const grp=(id,status,paused=0)=>db.prepare("INSERT INTO group_access(chat_id,status,requested_at,paused) VALUES(?,?,'2026-10-01T00:00:00Z',?)").run(id,status,paused);
 const boss=id=>db.prepare("INSERT INTO boss_kills(chat_id,boss_key,boss_name,kill_time,respawn_time) VALUES(?,?,?,?,?)").run(id,'a','公墓3','2026-11-24T01:00:00Z','2026-11-24T05:00:00Z');
 return {db,grp,boss,env:{PRODUCTION_MODE:'true',ENABLE_DAILY_KB_PUSH:'true',DATABASE_BACKEND:'d1',BOSS_DB,LINE_CHANNEL_ACCESS_TOKEN:'tok'}};
}
const recorder=(status=200)=>{const calls=[];return {calls,fetcher:async(url,o)=>{calls.push({url,body:JSON.parse(o.body),auth:o.headers.Authorization});return {ok:status<400,status};}};};

test('pushes the KB card only to approved, un-paused groups that have records',async()=>{
 const {db,grp,boss,env}=setup();try{
  grp(G1,'approved');boss(G1);
  grp(G2,'approved',1);boss(G2);      // paused
  grp(G3,'pending');boss(G3);         // not approved
  grp(G4,'approved');                 // no records
  grp('U'+'a'.repeat(32),'approved'); // private user, never pushed
  const r=recorder();
  const out=await runDailyKbPush(env,r.fetcher,new Date('2026-11-24T10:00:00Z'));
  assert.deepEqual(out,{groups:2,sent:1,empty:1,failed:0});
  assert.equal(r.calls.length,1);
  assert.equal(r.calls[0].url,'https://api.line.me/v2/bot/message/push');
  assert.equal(r.calls[0].body.to,G1);
  assert.equal(r.calls[0].body.messages[0].type,'flex');
  assert.equal(r.calls[0].auth,'Bearer tok');
 }finally{db.close();}
});

test('does nothing unless enabled and configured; failures are counted',async()=>{
 const {db,grp,boss,env}=setup();try{
  grp(G5,'approved');boss(G5);
  const r=recorder();
  assert.deepEqual(await runDailyKbPush({...env,ENABLE_DAILY_KB_PUSH:'false'},r.fetcher,SLOT),{skipped:'disabled'});
  assert.deepEqual(await runDailyKbPush({...env,PRODUCTION_MODE:'false'},r.fetcher,SLOT),{skipped:'disabled'});
  assert.deepEqual(await runDailyKbPush({...env,LINE_CHANNEL_ACCESS_TOKEN:''},r.fetcher,SLOT),{skipped:'not-configured'});
  assert.equal(r.calls.length,0);
  assert.equal((await runDailyKbPush(env,recorder(500).fetcher,new Date('2026-11-25T10:00:00Z'))).failed,1);
  assert.equal((await runDailyKbPush(env,async()=>{throw new Error('down');},new Date('2026-11-26T10:00:00Z'))).failed,1);
 }finally{db.close();}
});

test('the production worker exposes the scheduled handler and fails loudly on push errors',async()=>{
 const {db,grp,boss,env}=setup();try{
  grp(G5,'approved');boss(G5);
  assert.equal(typeof production.scheduled,'function');
  const original=globalThis.fetch;
  globalThis.fetch=async()=>({ok:false,status:500});
  try{await assert.rejects(production.scheduled({scheduledTime:Date.parse('2026-11-24T10:00:00Z')},env),/failed for 1 group/);}
  finally{globalThis.fetch=original;}
 }finally{db.close();}
});

test('the card switch turns the daily push off and on again',async()=>{
 const {processGroupAccessCommand}=await import('../src/group-access.js');
 const {createSql}=await import('../src/database.js');
 const {db,grp,boss,env}=setup();try{
  grp(G5,'approved');boss(G5);
  const user='U'+'b'.repeat(32),ctx={userId:user,sourceType:'user'},now=new Date('2026-11-24T10:00:00Z');
  const admin={...env,ENABLE_STAGING_GROUP_ACCESS_ADMIN:'true',ADMIN_PASSWORD:'x'};
  const sql=createSql(env);
  const run=text=>processGroupAccessCommand(text,user,admin,sql,now,ctx,sql);
  assert.match(JSON.stringify(await run('群組管理')),/目前：開啟/);
  assert.match(JSON.stringify(await run('關閉每日推播')),/目前：關閉.*開啟每日推播/);
  const r=recorder();
  assert.deepEqual(await runDailyKbPush(env,r.fetcher,SLOT),{skipped:'switched-off'});assert.equal(r.calls.length,0);
  assert.match(JSON.stringify(await run('開啟每日推播')),/目前：開啟.*關閉每日推播/);
  assert.equal((await runDailyKbPush(env,r.fetcher,SLOT)).sent,1);
  // not from a group, and not on the production bot
  assert.match((await processGroupAccessCommand('關閉每日推播',G5,admin,sql,now,{userId:user,sourceType:'group'},sql)).text,/私訊/);
  assert.equal(await processGroupAccessCommand('關閉每日推播',user,{...admin,ENABLE_STAGING_GROUP_ACCESS_ADMIN:'false'},sql,now,ctx,sql),null);
 }finally{db.close();}
});

test('sends only in the configured half-hour slot, once per day',async()=>{
 const {processGroupAccessCommand}=await import('../src/group-access.js');
 const {createSql}=await import('../src/database.js');
 const {db,grp,boss,env}=setup();try{
  grp(G5,'approved');boss(G5);
  const user='U'+'b'.repeat(32),ctx={userId:user,sourceType:'user'},now=new Date('2026-11-24T10:00:00Z');
  const admin={...env,ENABLE_STAGING_GROUP_ACCESS_ADMIN:'true',ADMIN_PASSWORD:'x'};
  const sql=createSql(env);
  const run=text=>processGroupAccessCommand(text,user,admin,sql,now,ctx,sql);
  const r=recorder();
  const at=iso=>runDailyKbPush(env,r.fetcher,new Date(iso));
  // default 18:00 Taipei = 10:00Z; other slots stay quiet
  assert.deepEqual(await at('2026-11-24T09:30:00Z'),{skipped:'not-this-time'});
  assert.equal((await at('2026-11-24T10:00:00Z')).sent,1);
  assert.deepEqual(await at('2026-11-24T10:00:00Z'),{skipped:'already-sent-today'}); // never twice in a day
  assert.equal((await at('2026-11-25T10:00:00Z')).sent,1);                           // next day sends again
  // change the time from the card
  assert.match(JSON.stringify(await run('推播時間 20:30')),/每天 20:30/);
  assert.deepEqual(await at('2026-11-26T10:00:00Z'),{skipped:'not-this-time'});
  assert.equal((await at('2026-11-26T12:30:00Z')).sent,1);                           // 20:30 Taipei
  assert.match(JSON.stringify(await run('推播時間 8:00')),/每天 08:00/);
  for(const bad of ['推播時間 18:15','推播時間 25:00','推播時間 晚上六點'])assert.match((await run(bad)).text,/時間格式錯誤/);
  assert.match((await processGroupAccessCommand('推播時間 20:00',G5,admin,sql,now,{userId:user,sourceType:'group'},sql)).text,/私訊/);
  assert.equal(await processGroupAccessCommand('推播時間 20:00',user,{...admin,ENABLE_STAGING_GROUP_ACCESS_ADMIN:'false'},sql,now,ctx,sql),null);
 }finally{db.close();}
});
