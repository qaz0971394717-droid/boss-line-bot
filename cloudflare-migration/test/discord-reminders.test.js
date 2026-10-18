import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {discordReminderRequest,syncFutureDiscordReminders} from '../src/discord-reminders.js';
import {stagingReminderRequest,reminderWarning} from '../src/reminders.js';
import {createProductionWorker} from '../src/production.js';
import {handleLineCommand} from '../src/line-commands.js';
import {UNDO_SCHEMA,undoEnvironment} from '../src/undo.js';

const payload={chatId:'mapped',bossKey:'王h',bossName:'王H',respawnAt:'2099-01-01T00:00:00Z'};
function service(){
 const jobs=new Map(),calls=[];
 const binding={idFromName:name=>name,get(id){return {async schedule(data){calls.push(['schedule',id]);if(data.chatId!=='mapped')return {ok:true,skipped:true};jobs.set(id,data);return {ok:true,destination:'discord',pending:2};},async cancel(){calls.push(['cancel',id]);jobs.delete(id);return {ok:true};}};}};
 return {jobs,calls,env:{PRODUCTION_MODE:'true',ENABLE_DISCORD_REMINDERS:'true',DISCORD_REMINDER:binding}};
}
test('production uses only the existing Discord object and staging cannot invoke it',async()=>{
 const {env,calls,jobs}=service();
 const noNetwork=()=>{throw Error('Discord RPC must not call LINE or external HTTP');};
 assert.equal((await stagingReminderRequest(env,'/schedule',payload,noNetwork)).sent,true);
 assert.deepEqual(calls,[['schedule','mapped:王h']]);assert.equal(jobs.get('mapped:王h').respawnAt,payload.respawnAt);
 assert.equal((await stagingReminderRequest(env,'/cancel',payload,noNetwork)).sent,true);assert.equal(jobs.size,0);
 for(const overrides of [{PRODUCTION_MODE:'false'},{ENABLE_DISCORD_REMINDERS:'false'},{DISCORD_REMINDER:null}])assert.equal((await discordReminderRequest({...env,...overrides},'/schedule',payload)).sent,false);
 assert.equal(calls.length,2);
 assert.equal((await discordReminderRequest(env,'/push',payload)).reason,'invalid-path');
 assert.equal((await discordReminderRequest(env,'/schedule',{...payload,respawnAt:'invalid'})).reason,'invalid-payload');
 assert.equal(calls.length,2);
});
test('unmapped groups intentionally skip while rejected and failed Discord calls warn',async()=>{
 const {env}=service();
 const skipped=await discordReminderRequest(env,'/schedule',{...payload,chatId:'other'});
 assert.equal(skipped.skipped,true);assert.equal(reminderWarning(env,skipped),'');
 const failed={...env,DISCORD_REMINDER:{idFromName:x=>x,get(){return {async schedule(){throw Error('not available');}};}}};
 const result=await discordReminderRequest(failed,'/schedule',payload);assert.equal(result.sent,false);assert.match(reminderWarning(failed,result),/Discord/);
 const rejected={...env,DISCORD_REMINDER:{idFromName:x=>x,get(){return {async schedule(){return {ok:true,destination:'line'};}};}}};
 assert.equal((await discordReminderRequest(rejected,'/schedule',payload)).sent,false);
});
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../d1/0001_core.sql',import.meta.url),'utf8'));for(const sql of UNDO_SCHEMA)db.exec(sql);
 const binding={prepare(sql){const make=args=>({async all(){return {success:true,results:db.prepare(sql).all(...args)};},async run(){return {success:true,...db.prepare(sql).run(...args)};}});return {...make([]),bind(...args){return {...make(args),statement:{sql,args}};}};},async batch(statements){db.exec('BEGIN');try{const results=statements.map(s=>({success:true,results:db.prepare(s.statement.sql).all(...s.statement.args)}));db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}};
 return {db,binding};
}
test('future schedule recovery reads without modifying BOSS records and honors original group mapping',async()=>{
 const {db,binding}=fixture(),{env,jobs}=service();try{
 db.exec("INSERT INTO boss_types VALUES('王h','王H',60)");
 const insert=db.prepare('INSERT INTO boss_kills(chat_id,boss_key,boss_name,kill_time,respawn_time) VALUES(?,?,?,?,?)');
 insert.run('mapped','王h','王H','2026-10-17T00:00:00Z','2099-01-01T00:00:00Z');
 insert.run('other','王h','王H','2026-10-17T00:00:00Z','2099-01-01T00:00:00Z');
 insert.run('past','王h','王H','2026-10-17T00:00:00Z','2026-10-17T01:00:00Z');
 const changes=db.prepare('SELECT total_changes() n').get().n;
 assert.deepEqual(await syncFutureDiscordReminders({...env,BOSS_DB:binding},new Date('2026-10-18T00:00:00Z')),{considered:2,scheduled:1,skipped:1,failed:0,pending:2});
 assert.equal(jobs.size,1);assert.equal(db.prepare('SELECT total_changes() n').get().n,changes);
 }finally{db.close();}
});
test('K, modify, cancel, undo and confirmed clear keep Discord schedules aligned',async()=>{
 const {db,binding}=fixture(),{env,jobs}=service();
 const configured={...env,BOSS_DB:binding,DATABASE_BACKEND:'d1',STAGING_MODE:'true',ENABLE_UNDO:'true'};
 let now=Date.parse('2026-10-18T02:00:00Z');const run=input=>handleLineCommand(input,'mapped',undoEnvironment(configured,input,'mapped','tester'),new Date(++now),{userId:'tester',eventTimestamp:now});
 try{
 db.exec("INSERT INTO boss_types VALUES('王h','王H',60)");
 await run('K 王H');assert.equal(jobs.size,1);
 await run('復原');assert.equal(jobs.size,0);
 await run('K 王H');const previous=jobs.get('mapped:王h').respawnAt;
 await run('修改出生 王H 2099-01-01 15:00:00');assert.notEqual(jobs.get('mapped:王h').respawnAt,previous);
 await run('復原');assert.equal(jobs.get('mapped:王h').respawnAt,previous);
 await run('取消 王H');assert.equal(jobs.size,0);
 await run('復原');assert.equal(jobs.size,1);
 await run('清除KB');assert.equal(jobs.size,1);await run('是');assert.equal(jobs.size,0);
 assert.equal(db.prepare('SELECT count(*) n FROM boss_kills').get().n,0);
 }finally{db.close();}
});
test('production forwards only the Discord binding and leaves LINE pushes disabled',async()=>{
 let received;const {env}=service();
 const worker=createProductionWorker({worker:{fetch(_request,config){received=config;return new Response('ok');}}});
 const configured={...env,ENABLE_LINE:'true',DATABASE_BACKEND:'d1',BOSS_DB:{prepare(){}},LINE_CHANNEL_SECRET:'secret',LINE_CHANNEL_ACCESS_TOKEN:'token',ENABLE_STAGING_REMINDERS:'true',STAGING_REMINDER_WORKER_URL:'https://wrong.example'};
 await worker.fetch(new Request('https://prod.test/callback',{method:'POST'}),configured);
 assert.equal(received.DISCORD_REMINDER,env.DISCORD_REMINDER);assert.equal(received.ENABLE_STAGING_REMINDERS,'false');assert.equal(received.STAGING_REMINDER_WORKER_URL,undefined);
 const health=await (await worker.fetch(new Request('https://prod.test'),configured)).json();
 assert.equal(health.discord_reminders_enabled,true);assert.equal(health.line_reminders_enabled,false);assert.equal(health.reminders_enabled,false);
});
test('manual sync is scoped to the requesting chat and disabled on staging',async()=>{
 const {db,binding}=fixture(),{env,jobs}=service();
 try{
 db.exec("INSERT INTO boss_types VALUES('王h','王H',60)");
 const insert=db.prepare('INSERT INTO boss_kills(chat_id,boss_key,boss_name,kill_time,respawn_time) VALUES(?,?,?,?,?)');
 for(const chat of ['mapped','other'])insert.run(chat,'王h','王H','2026-10-17T00:00:00Z','2099-01-01T00:00:00Z');
 const configured={...env,BOSS_DB:binding,DATABASE_BACKEND:'d1',STAGING_MODE:'true'};
 const before=db.prepare('SELECT * FROM boss_kills ORDER BY chat_id').all();
 assert.match((await handleLineCommand('同步提醒','mapped',configured)).text,/1 筆/);
 assert.equal(jobs.size,1);assert.deepEqual(db.prepare('SELECT * FROM boss_kills ORDER BY chat_id').all(),before);
 assert.match((await handleLineCommand('同步提醒','mapped',{...configured,PRODUCTION_MODE:'false'})).text,/未啟用/);
 assert.equal(jobs.size,1);
 }finally{db.close();}
});
