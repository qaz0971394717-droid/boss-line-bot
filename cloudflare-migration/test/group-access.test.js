import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {GROUP_ACCESS_SCHEMA,groupAccessReply,processGroupAccessCommand} from '../src/group-access.js';
import {createSql} from '../src/database.js';
import {shouldProcessCommand} from '../src/command-filter.js';

function setup(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE chat_settings(chat_id TEXT PRIMARY KEY,half_mode INTEGER NOT NULL DEFAULT 0); CREATE TABLE boss_kills(chat_id TEXT NOT NULL,boss_key TEXT NOT NULL,boss_name TEXT NOT NULL,kill_time TEXT,respawn_time TEXT,PRIMARY KEY(chat_id,boss_key));');
 for(const sql of GROUP_ACCESS_SCHEMA)db.exec(sql);
 const env={DATABASE_BACKEND:'d1',ENABLE_GROUP_APPROVAL:'true',ENABLE_STAGING_GROUP_ACCESS_ADMIN:'true',ENABLE_ADMIN_ACTOR_GUARD:'true',ADMIN_PASSWORD:'owner-secret',BOSS_DB:{prepare(query){return {bind(...args){return {async all(){return {success:true,results:db.prepare(query).all(...args)}}}}}}}};
 return {db,env,sql:createSql(env)};
}
const now=new Date('2026-10-18T10:00:00Z');
const group='Cb6a98e7cead691d3f43cf6a743f34191';

test('existing groups remain approved; old settings rows are grandfathered even without backfill',async()=>{
 const {db,env,sql}=setup();try{
  db.prepare('INSERT INTO chat_settings(chat_id,half_mode) VALUES(?,1)').run(group);
  assert.equal(await groupAccessReply('KB',group,'group',env,sql,now),null);
  assert.equal(db.prepare('SELECT status FROM group_access WHERE chat_id=?').get(group).status,'approved');
  assert.match((await groupAccessReply('申請使用',group,'group',env,sql,now)).text,/已授權/);
 }finally{db.close();}
});

test('new group commands are blocked and the request returns its chat ID',async()=>{
 const {db,env,sql}=setup();try{
  const blocked=await groupAccessReply('K 大象H','C'+'a'.repeat(32),'group',env,sql,now);
  assert.match(blocked.text,/尚未授權/);
  assert.match((await groupAccessReply('授權群組數','C'+'a'.repeat(32),'group',env,sql,now)).text,/尚未授權/);
  assert.match((await groupAccessReply('撤銷群組授權 C'+'a'.repeat(32),'C'+'a'.repeat(32),'group',env,sql,now)).text,/尚未授權/);
  assert.match(blocked.text,/Caaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.equal(db.prepare('SELECT status FROM group_access').get().status,'pending');
  const requested=await groupAccessReply('申請使用','C'+'a'.repeat(32),'group',env,sql,now);
  assert.match(requested.text,/申請使用/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM boss_kills').get().n,0);
 }finally{db.close();}
});

test('only a private DM can start and complete password-protected approval',async()=>{
 const {db,env,sql}=setup();try{
  await groupAccessReply('申請使用','C'+'a'.repeat(32),'group',env,sql,now);
  const target='C'+'a'.repeat(32),user='U'+'b'.repeat(32);
  assert.match((await processGroupAccessCommand(`授權群組 ${target}`,target,env,sql,now,{userId:user,sourceType:'group'})).text,/私訊/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM group_access_challenges').get().n,0);
  assert.match((await processGroupAccessCommand(`授權群組 ${target}`,user,env,sql,now,{userId:user,sourceType:'user'})).text,/60 秒/);
  assert.equal(await shouldProcessCommand('owner-secret',user,env,{userId:user}),true);
  assert.match((await processGroupAccessCommand('owner-secret',user,env,sql,now,{userId:user,sourceType:'user'})).text,/已授權群組/);
  assert.equal(db.prepare('SELECT status FROM group_access WHERE chat_id=?').get(target).status,'approved');
  assert.equal(db.prepare('SELECT count(*) AS n FROM group_access_challenges').get().n,0);
 }finally{db.close();}
});

test('wrong password and approvals without a pending request fail closed',async()=>{
 const {db,env,sql}=setup();try{
  const target='C'+'a'.repeat(32),user='U'+'b'.repeat(32);
  await groupAccessReply('申請使用',target,'group',env,sql,now);
  await processGroupAccessCommand(`授權群組 ${target}`,user,env,sql,now,{userId:user,sourceType:'user'});
  assert.match((await processGroupAccessCommand('wrong',user,env,sql,now,{userId:user,sourceType:'user'})).text,/密碼錯誤/);
  const other='C'+'c'.repeat(32);
  await processGroupAccessCommand(`授權群組 ${other}`,user,env,sql,now,{userId:user,sourceType:'user'});
  assert.match((await processGroupAccessCommand('owner-secret',user,env,sql,now,{userId:user,sourceType:'user'})).text,/待審申請/);
  assert.equal(db.prepare('SELECT status FROM group_access WHERE chat_id=?').get(target).status,'pending');
 }finally{db.close();}
});

test('group can query only the count of approved groups',async()=>{
 const {db,env,sql}=setup();try{
  db.prepare("INSERT INTO group_access(chat_id,status,requested_at) VALUES(?,?,?)").run('approved-1','approved',now.toISOString());
  db.prepare("INSERT INTO group_access(chat_id,status,requested_at) VALUES(?,?,?)").run('approved-2','approved',now.toISOString());
  db.prepare("INSERT INTO group_access(chat_id,status,requested_at) VALUES(?,?,?)").run('pending-1','pending',now.toISOString());
  const user='U'+'b'.repeat(32);
  const reply=await processGroupAccessCommand('授權群組數',user,env,sql,now,{sourceType:'user',userId:user});
  assert.match(reply.text,/目前已授權：2 個群組/);
  assert.doesNotMatch(reply.text,/approved-1|approved-2/);
  assert.match((await processGroupAccessCommand('授權群組數',group,env,sql,now,{sourceType:'group',userId:user})).text,/請私訊/);
 }finally{db.close();}
});

test('authorization count and revoke commands are disabled outside staging opt-in',async()=>{
 const {db,env,sql}=setup();try{
  env.ENABLE_STAGING_GROUP_ACCESS_ADMIN='false';
  assert.equal(await processGroupAccessCommand('授權群組數',group,env,sql,now,{sourceType:'group',userId:'owner'}),null);
  assert.equal(await processGroupAccessCommand(`撤銷群組授權 ${group}`,group,env,sql,now,{sourceType:'user',userId:group}),null);
  assert.equal(await shouldProcessCommand('授權群組數',group,env,{userId:'owner'}),false);
  assert.equal(await shouldProcessCommand(`撤銷群組授權 ${group}`,group,env,{userId:'owner'}),false);
 }finally{db.close();}
});

test('revoking a group requires private password confirmation and disables it',async()=>{
 const {db,env,sql}=setup();try{
  db.prepare("INSERT INTO group_access(chat_id,status,requested_at) VALUES(?,?,?)").run(group,'approved',now.toISOString());
  const user='U'+'b'.repeat(32);
  const groupAttempt=await processGroupAccessCommand(`撤銷群組授權 ${group}`,group,env,sql,now,{sourceType:'group',userId:user});
  assert.match(groupAttempt.text,/1 對 1 私訊/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM group_access_action_challenges').get().n,0);
  const prompt=await processGroupAccessCommand(`撤銷群組授權 ${group}`,user,env,sql,now,{sourceType:'user',userId:user});
  assert.match(prompt.text,/60 秒內於此私訊輸入管理密碼/);
  assert.equal(db.prepare('SELECT status FROM group_access WHERE chat_id=?').get(group).status,'approved');
  assert.equal(await shouldProcessCommand('owner-secret',user,env,{userId:user}),true);
  const result=await processGroupAccessCommand('owner-secret',user,env,sql,now,{sourceType:'user',userId:user});
  assert.match(result.text,/已移除群組 .* 的授權/);
  assert.equal(db.prepare('SELECT status FROM group_access WHERE chat_id=?').get(group).status,'denied');
  assert.equal(db.prepare('SELECT count(*) AS n FROM group_access_action_challenges').get().n,0);
 }finally{db.close();}
});

test('wrong private password does not revoke a group',async()=>{
 const {db,env,sql}=setup();try{
  db.prepare("INSERT INTO group_access(chat_id,status,requested_at) VALUES(?,?,?)").run(group,'approved',now.toISOString());
  const user='U'+'b'.repeat(32);
  await processGroupAccessCommand(`撤銷群組授權 ${group}`,user,env,sql,now,{sourceType:'user',userId:user});
  const result=await processGroupAccessCommand('wrong-password',user,env,sql,now,{sourceType:'user',userId:user});
  assert.match(result.text,/密碼錯誤/);
  assert.equal(db.prepare('SELECT status FROM group_access WHERE chat_id=?').get(group).status,'approved');
 }finally{db.close();}
});

test('challenge replies are not treated as normal messages without an active approval challenge',async()=>{
 const {db,env}=setup();try{
  assert.equal(await shouldProcessCommand('owner-secret','U'+'b'.repeat(32),env,{userId:'U'+'b'.repeat(32)}),false);
 }finally{db.close();}
});
