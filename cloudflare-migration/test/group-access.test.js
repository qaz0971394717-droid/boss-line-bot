import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {GROUP_ACCESS_SCHEMA,groupAccessReply,processGroupAccessCommand,rememberGroupName} from '../src/group-access.js';
import {createSql} from '../src/database.js';
import {shouldProcessCommand,groupPaused,PAUSED_REPLY_TEXT} from '../src/command-filter.js';

function setup(){
 const db=new DatabaseSync(':memory:');
 const productionDb=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE chat_settings(chat_id TEXT PRIMARY KEY,half_mode INTEGER NOT NULL DEFAULT 0); CREATE TABLE boss_kills(chat_id TEXT NOT NULL,boss_key TEXT NOT NULL,boss_name TEXT NOT NULL,kill_time TEXT,respawn_time TEXT,PRIMARY KEY(chat_id,boss_key));');
 for(const sql of GROUP_ACCESS_SCHEMA)db.exec(sql);
 for(const sql of GROUP_ACCESS_SCHEMA)productionDb.exec(sql);
 const binding=database=>({prepare(query){return {bind(...args){return {async all(){return {success:true,results:database.prepare(query).all(...args)}}}}}}});
 const env={DATABASE_BACKEND:'d1',ENABLE_GROUP_APPROVAL:'true',ENABLE_STAGING_GROUP_ACCESS_ADMIN:'true',ENABLE_ADMIN_ACTOR_GUARD:'true',ADMIN_PASSWORD:'owner-secret',BOSS_DB:binding(db),PRODUCTION_BOSS_DB:binding(productionDb)};
 return {db,productionDb,env,sql:createSql(env),managementSql:createSql({DATABASE_BACKEND:'d1',BOSS_DB:env.PRODUCTION_BOSS_DB})};
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
  const {db,productionDb,env,sql,managementSql}=setup();try{
  productionDb.prepare("INSERT INTO group_access(chat_id,status,requested_at) VALUES(?,?,?)").run('approved-1','approved',now.toISOString());
  productionDb.prepare("INSERT INTO group_access(chat_id,status,requested_at) VALUES(?,?,?)").run('approved-2','approved',now.toISOString());
  productionDb.prepare("INSERT INTO group_access(chat_id,status,requested_at) VALUES(?,?,?)").run('pending-1','pending',now.toISOString());
  const user='U'+'b'.repeat(32);
  const reply=await processGroupAccessCommand('授權群組數',user,env,sql,now,{sourceType:'user',userId:user},managementSql);
  assert.match(reply.text,/正式版目前已授權：2 個群組/);
  assert.doesNotMatch(reply.text,/approved-1|approved-2/);
  assert.match((await processGroupAccessCommand('授權群組數',group,env,sql,now,{sourceType:'group',userId:user},managementSql)).text,/請私訊/);
 }finally{db.close();productionDb.close();}
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
 const {db,productionDb,env,sql,managementSql}=setup();try{
  productionDb.prepare("INSERT INTO group_access(chat_id,status,requested_at) VALUES(?,?,?)").run(group,'approved',now.toISOString());
  const user='U'+'b'.repeat(32);
  const groupAttempt=await processGroupAccessCommand(`撤銷群組授權 ${group}`,group,env,sql,now,{sourceType:'group',userId:user},managementSql);
  assert.match(groupAttempt.text,/1 對 1 私訊/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM group_access_action_challenges').get().n,0);
  const prompt=await processGroupAccessCommand(`撤銷群組授權 ${group}`,user,env,sql,now,{sourceType:'user',userId:user},managementSql);
  assert.match(prompt.text,/60 秒內於此私訊輸入管理密碼/);
  assert.equal(productionDb.prepare('SELECT status FROM group_access WHERE chat_id=?').get(group).status,'approved');
  assert.equal(await shouldProcessCommand('owner-secret',user,env,{userId:user}),true);
  const result=await processGroupAccessCommand('owner-secret',user,env,sql,now,{sourceType:'user',userId:user},managementSql);
  assert.match(result.text,/已移除群組 .* 的授權/);
  assert.equal(productionDb.prepare('SELECT status FROM group_access WHERE chat_id=?').get(group).status,'denied');
  assert.equal(db.prepare('SELECT count(*) AS n FROM group_access_action_challenges').get().n,0);
 }finally{db.close();productionDb.close();}
});

test('wrong private password does not revoke a group',async()=>{
 const {db,productionDb,env,sql,managementSql}=setup();try{
  productionDb.prepare("INSERT INTO group_access(chat_id,status,requested_at) VALUES(?,?,?)").run(group,'approved',now.toISOString());
  const user='U'+'b'.repeat(32);
  await processGroupAccessCommand(`撤銷群組授權 ${group}`,user,env,sql,now,{sourceType:'user',userId:user},managementSql);
  const result=await processGroupAccessCommand('wrong-password',user,env,sql,now,{sourceType:'user',userId:user},managementSql);
  assert.match(result.text,/密碼錯誤/);
  assert.equal(productionDb.prepare('SELECT status FROM group_access WHERE chat_id=?').get(group).status,'approved');
 }finally{db.close();productionDb.close();}
});

test('challenge replies are not treated as normal messages without an active approval challenge',async()=>{
 const {db,env}=setup();try{
  assert.equal(await shouldProcessCommand('owner-secret','U'+'b'.repeat(32),env,{userId:'U'+'b'.repeat(32)}),false);
 }finally{db.close();}
});

test('staging admin DM approves a pending production group without touching staging data',async()=>{
 const {db,productionDb,env,sql,managementSql}=setup();try{
  const target='C'+'a'.repeat(32),user='U'+'b'.repeat(32);
  productionDb.prepare("INSERT INTO group_access(chat_id,status,requested_at) VALUES(?,?,?)").run(target,'pending',now.toISOString());
  const ctx={userId:user,sourceType:'user'};
  assert.match((await processGroupAccessCommand(`授權群組 ${target}`,user,env,sql,now,ctx,managementSql)).text,/60 秒/);
  assert.match((await processGroupAccessCommand('wrong',user,env,sql,now,ctx,managementSql)).text,/密碼錯誤/);
  assert.equal(productionDb.prepare('SELECT status FROM group_access WHERE chat_id=?').get(target).status,'pending');
  await processGroupAccessCommand(`授權群組 ${target}`,user,env,sql,now,ctx,managementSql);
  assert.match((await processGroupAccessCommand('owner-secret',user,env,sql,now,ctx,managementSql)).text,/已授權群組/);
  assert.equal(productionDb.prepare('SELECT status,approved_by FROM group_access WHERE chat_id=?').get(target).approved_by,user);
  assert.equal(db.prepare('SELECT count(*) AS n FROM group_access').get().n,0);
 }finally{db.close();productionDb.close();}
});

test('staging admin DM still approves a group that applied to the staging bot',async()=>{
 const {db,productionDb,env,sql,managementSql}=setup();try{
  const target='C'+'a'.repeat(32),user='U'+'b'.repeat(32);
  await groupAccessReply('申請使用',target,'group',env,sql,now);
  const ctx={userId:user,sourceType:'user'};
  await processGroupAccessCommand(`授權群組 ${target}`,user,env,sql,now,ctx,managementSql);
  assert.match((await processGroupAccessCommand('owner-secret',user,env,sql,now,ctx,managementSql)).text,/已授權群組/);
  assert.equal(db.prepare('SELECT status FROM group_access WHERE chat_id=?').get(target).status,'approved');
 }finally{db.close();productionDb.close();}
});

test('production bot approval never reaches another database',async()=>{
 const {db,productionDb,env,sql,managementSql}=setup();try{
  const target='C'+'a'.repeat(32),user='U'+'b'.repeat(32);
  productionDb.prepare("INSERT INTO group_access(chat_id,status,requested_at) VALUES(?,?,?)").run(target,'pending',now.toISOString());
  const prodEnv={...env,ENABLE_STAGING_GROUP_ACCESS_ADMIN:undefined};
  const ctx={userId:user,sourceType:'user'};
  await processGroupAccessCommand(`授權群組 ${target}`,user,prodEnv,sql,now,ctx);
  assert.match((await processGroupAccessCommand('owner-secret',user,prodEnv,sql,now,ctx)).text,/待審申請/);
 }finally{db.close();productionDb.close();}
});

test('group admin card lists approved and pending groups; buttons reuse the password-protected commands',async()=>{
 const {db,productionDb,env,sql,managementSql}=setup();try{
  const user='U'+'b'.repeat(32),ok='C'+'1'.repeat(32),wait='C'+'2'.repeat(32),old='C'+'3'.repeat(32);
  productionDb.prepare("INSERT INTO group_access(chat_id,status,requested_at,approved_at,approved_by) VALUES(?,'approved','2026-10-01T00:00:00Z','2026-10-02T00:00:00Z',?)").run(ok,user);
  productionDb.prepare("INSERT INTO group_access(chat_id,status,requested_at,approved_at,approved_by) VALUES(?,'approved','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z','grandfathered')").run(old);
  productionDb.prepare("INSERT INTO group_access(chat_id,status,requested_at) VALUES(?,'pending','2026-10-30T00:00:00Z')").run(wait);
  const card=await processGroupAccessCommand('群組管理',user,env,sql,now,{userId:user,sourceType:'user'},managementSql);
  assert.equal(card.type,'flex');
  const json=JSON.stringify(card);
  assert.match(json,/已授權群組（2）/);assert.match(json,/等待核准（1）/);
  assert.match(json,new RegExp(`撤銷群組授權 ${ok}`));assert.match(json,new RegExp(`授權群組 ${wait}`));
  assert.ok(json.length<20000);
  // Tapping 撤銷 starts the normal password challenge; nothing changes until it is confirmed.
  assert.match((await processGroupAccessCommand(`撤銷群組授權 ${ok}`,user,env,sql,now,{userId:user,sourceType:'user'},managementSql)).text,/管理密碼/);
  assert.equal(productionDb.prepare('SELECT status FROM group_access WHERE chat_id=?').get(ok).status,'approved');
  assert.match((await processGroupAccessCommand('owner-secret',user,env,sql,now,{userId:user,sourceType:'user'},managementSql)).text,/已移除群組/);
  assert.equal(productionDb.prepare('SELECT status FROM group_access WHERE chat_id=?').get(ok).status,'denied');
  const after=JSON.stringify(await processGroupAccessCommand('群組管理',user,env,sql,now,{userId:user,sourceType:'user'},managementSql));
  assert.match(after,/已授權群組（1）/);
 }finally{db.close();productionDb.close();}
});

test('group admin card is private-chat only, staging-only and handles empty lists',async()=>{
 const {db,productionDb,env,sql,managementSql}=setup();try{
  const user='U'+'b'.repeat(32),group='C'+'4'.repeat(32);
  assert.match((await processGroupAccessCommand('群組管理',group,env,sql,now,{userId:user,sourceType:'group'},managementSql)).text,/私訊/);
  assert.equal(await processGroupAccessCommand('群組管理',user,{...env,ENABLE_STAGING_GROUP_ACCESS_ADMIN:'false'},sql,now,{userId:user,sourceType:'user'},managementSql),null);
  assert.equal(await shouldProcessCommand('群組管理',user,{...env,ENABLE_STAGING_GROUP_ACCESS_ADMIN:'false'},{userId:user}),false);
  assert.equal(await shouldProcessCommand('群組管理',user,env,{userId:user}),true);
  const card=JSON.stringify(await processGroupAccessCommand('群組管理',user,env,sql,now,{userId:user,sourceType:'user'},managementSql));
  assert.match(card,/已授權群組（0）/);assert.match(card,/目前沒有/);
 }finally{db.close();productionDb.close();}
});

test('group names are stored once, refreshed weekly, and failures never throw',async()=>{
 const {db,productionDb,env,sql,managementSql}=setup();try{
  const g='C'+'5'.repeat(32),user='U'+'b'.repeat(32);let calls=0,fail=false;
  const fetcher=async url=>{calls++;assert.match(url,new RegExp(`/bot/group/${g}/summary$`));if(fail)throw new Error('down');return {ok:true,json:async()=>({groupName:'血盟 A 隊'})};};
  await rememberGroupName(g,'group',env,sql,fetcher,now);assert.equal(calls,0);// unknown group: nothing to update
  db.prepare("INSERT INTO group_access(chat_id,status,requested_at) VALUES(?,'approved','2026-10-01T00:00:00Z')").run(g);
  await rememberGroupName(g,'room',env,sql,fetcher,now);assert.equal(calls,0);// rooms have no summary
  await rememberGroupName(g,'group',env,sql,fetcher,now);
  assert.equal(db.prepare('SELECT group_name FROM group_access WHERE chat_id=?').get(g).group_name,'血盟 A 隊');
  await rememberGroupName(g,'group',env,sql,fetcher,new Date(now.getTime()+3600000));assert.equal(calls,1);// cached
  fail=true;
  await rememberGroupName(g,'group',env,sql,fetcher,new Date(now.getTime()+8*86400000));// refresh fails, keeps old name
  assert.equal(db.prepare('SELECT group_name FROM group_access WHERE chat_id=?').get(g).group_name,'血盟 A 隊');
  productionDb.prepare("INSERT INTO group_access(chat_id,status,requested_at,approved_at,approved_by,group_name) VALUES(?,'approved','2026-10-01T00:00:00Z','2026-10-02T00:00:00Z',?,?)").run(g,user,'血盟 A 隊');
  productionDb.prepare("INSERT INTO group_access(chat_id,status,requested_at) VALUES(?,'pending','2026-10-30T00:00:00Z')").run('C'+'6'.repeat(32));
  const card=JSON.stringify(await processGroupAccessCommand('群組管理',user,env,sql,now,{userId:user,sourceType:'user'},managementSql));
  assert.match(card,/血盟 A 隊/);assert.match(card,/名稱未知/);
 }finally{db.close();productionDb.close();}
});

test('pending requests can be dismissed one by one or all at once without touching approved groups',async()=>{
 const {db,productionDb,env,sql,managementSql}=setup();try{
  const user='U'+'b'.repeat(32),ok='C'+'1'.repeat(32),p1='C'+'2'.repeat(32),p2='C'+'3'.repeat(32);
  const ins=(id,st)=>productionDb.prepare("INSERT INTO group_access(chat_id,status,requested_at) VALUES(?,?,'2026-10-30T00:00:00Z')").run(id,st);
  ins(ok,'approved');ins(p1,'pending');ins(p2,'pending');
  const ctx={userId:user,sourceType:'user'};
  const card=JSON.stringify(await processGroupAccessCommand('群組管理',user,env,sql,now,ctx,managementSql));
  assert.match(card,new RegExp(`移除申請 ${p1}`));assert.match(card,/全部移除待核准（2）/);
  assert.match(JSON.stringify(await processGroupAccessCommand(`移除申請 ${p1}`,user,env,sql,now,ctx,managementSql)),/等待核准（1）/);
  assert.equal(productionDb.prepare('SELECT count(*) AS n FROM group_access WHERE chat_id=?').get(p1).n,0);
  // A dismiss command can never remove an approved group.
  await processGroupAccessCommand(`移除申請 ${ok}`,user,env,sql,now,ctx,managementSql);
  assert.equal(productionDb.prepare('SELECT status FROM group_access WHERE chat_id=?').get(ok).status,'approved');
  assert.match(JSON.stringify(await processGroupAccessCommand('移除待核准',user,env,sql,now,ctx,managementSql)),/等待核准（0）/);
  assert.equal(productionDb.prepare('SELECT count(*) AS n FROM group_access').get().n,1);
  assert.match((await processGroupAccessCommand('移除待核准','C'+'4'.repeat(32),env,sql,now,{userId:user,sourceType:'group'},managementSql)).text,/私訊/);
  assert.equal(await processGroupAccessCommand('移除待核准',user,{...env,ENABLE_STAGING_GROUP_ACCESS_ADMIN:'false'},sql,now,ctx,managementSql),null);
  assert.equal(await shouldProcessCommand(`移除申請 ${p1}`,user,env,{userId:user}),true);
 }finally{db.close();productionDb.close();}
});

test('a paused group gets the fixed error text until resumed; approval is kept and only staging can toggle it',async()=>{
 const {db,productionDb,env,sql,managementSql}=setup();try{
  const user='U'+'b'.repeat(32),g='C'+'7'.repeat(32),pending='C'+'8'.repeat(32),ctx={userId:user,sourceType:'user'};
  productionDb.prepare("INSERT INTO group_access(chat_id,status,requested_at,approved_at,approved_by) VALUES(?,'approved','2026-10-01T00:00:00Z','2026-10-02T00:00:00Z',?)").run(g,user);
  productionDb.prepare("INSERT INTO group_access(chat_id,status,requested_at) VALUES(?,'pending','2026-10-30T00:00:00Z')").run(pending);
  const state=()=>productionDb.prepare('SELECT status,paused FROM group_access WHERE chat_id=?').get(g);
  assert.match(JSON.stringify(await processGroupAccessCommand('群組管理',user,env,sql,now,ctx,managementSql)),new RegExp(`暫停群組 ${g}`));
  // Not from a group, and not on the production bot.
  assert.match((await processGroupAccessCommand(`暫停群組 ${g}`,g,env,sql,now,{userId:user,sourceType:'group'},managementSql)).text,/私訊/);
  assert.equal(await processGroupAccessCommand(`暫停群組 ${g}`,user,{...env,ENABLE_STAGING_GROUP_ACCESS_ADMIN:'false'},sql,now,ctx,managementSql),null);
  assert.equal(state().paused,0);
  const card=JSON.stringify(await processGroupAccessCommand(`暫停群組 ${g}`,user,env,sql,now,ctx,managementSql));
  assert.deepEqual({...state()},{status:'approved',paused:1});
  assert.match(card,/已暫停/);assert.match(card,new RegExp(`恢復群組 ${g}`));
  // Pending groups cannot be paused.
  await processGroupAccessCommand(`暫停群組 ${pending}`,user,env,sql,now,ctx,managementSql);
  assert.equal(productionDb.prepare('SELECT paused FROM group_access WHERE chat_id=?').get(pending).paused,0);
  // The production bot answers a paused group with the fixed error text; other groups and private chats are unaffected.
  const prod={...env,BOSS_DB:env.PRODUCTION_BOSS_DB};
  const prodSql=createSql(prod);
  assert.equal(await groupPaused(prodSql,g),true);
  assert.equal(await groupPaused(prodSql,'C'+'9'.repeat(32)),false);
  assert.equal(await groupPaused(prodSql,user),false);
  assert.match(PAUSED_REPLY_TEXT,/資料庫連線逾時/);
  await processGroupAccessCommand(`恢復群組 ${g}`,user,env,sql,now,ctx,managementSql);
  assert.deepEqual({...state()},{status:'approved',paused:0});
  assert.equal(await groupPaused(prodSql,g),false);
 }finally{db.close();productionDb.close();}
});

test('worker answers a paused group with the fixed error text and runs nothing',async()=>{
 const {db,productionDb,env}=setup();try{
  const {createWorker}=await import('../src/index.js');
  const g='C'+'7'.repeat(32),other='C'+'8'.repeat(32);
  productionDb.prepare("INSERT INTO group_access(chat_id,status,requested_at,approved_at,approved_by,paused) VALUES(?,'approved','2026-10-01T00:00:00Z','2026-10-02T00:00:00Z','x',1)").run(g);
  const workerEnv={...env,BOSS_DB:env.PRODUCTION_BOSS_DB,LINE_CHANNEL_ACCESS_TOKEN:'t',LINE_CHANNEL_SECRET:'s',STAGING_MODE:'true',ENABLE_STAGING_LINE:'true',STAGING_DATABASE_URL:'x'};
  const sent=[];let claims=0;
  const app=createWorker({eventStoreFactory:()=>({claim:async()=>{claims++;return {state:'new'};},complete:async()=>{},delivered:async()=>{}}),fetcher:async(url,o)=>{sent.push(JSON.parse(o.body).messages[0].text);return new Response('{}',{status:200});}});
  const post=async(groupId,text,id)=>{
   const body=JSON.stringify({events:[{type:'message',webhookEventId:id,replyToken:'r'+id,timestamp:Date.now(),source:{type:'group',groupId,userId:'U'+'a'.repeat(32)},message:{type:'text',text}}]});
   const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('s'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const sig=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body)))));
   return app.fetch(new Request('https://x/callback',{method:'POST',body,headers:{'x-line-signature':sig}}),workerEnv,{waitUntil(){}});
  };
  assert.equal((await post(g,'K 公墓3','e1')).status,200);
  assert.deepEqual(sent,[PAUSED_REPLY_TEXT]);assert.equal(claims,0);
  await post(g,'隨便聊天','e2');assert.equal(sent.length,1);// not a command: still silent
 }finally{db.close();productionDb.close();}
});

test('private chats with the production bot are limited to the allowed user',async()=>{
 const {db,productionDb,env}=setup();try{
  const {createWorker}=await import('../src/index.js');
  const owner='U'+'a'.repeat(32),stranger='U'+'b'.repeat(32);
  const workerEnv={...env,BOSS_DB:env.PRODUCTION_BOSS_DB,LINE_CHANNEL_ACCESS_TOKEN:'t',LINE_CHANNEL_SECRET:'s',STAGING_MODE:'true',ENABLE_STAGING_LINE:'true',STAGING_DATABASE_URL:'x',PRIVATE_CHAT_ONLY_USER_ID:owner};
  const sent=[];let claims=0;
  const app=createWorker({eventStoreFactory:()=>({claim:async()=>{claims++;throw new Error('stop');},complete:async()=>{},delivered:async()=>{}}),fetcher:async(url,o)=>{sent.push(JSON.parse(o.body).messages[0].text);return new Response('{}',{status:200});}});
  const post=async(userId,text,id)=>{
   const body=JSON.stringify({events:[{type:'message',webhookEventId:id,replyToken:'r'+id,timestamp:Date.now(),source:{type:'user',userId},message:{type:'text',text}}]});
   const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('s'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const sig=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body)))));
   return app.fetch(new Request('https://x/callback',{method:'POST',body,headers:{'x-line-signature':sig}}),workerEnv,{waitUntil(){}});
  };
  await post(stranger,'KB','s1');
  assert.deepEqual(sent,[PAUSED_REPLY_TEXT]);assert.equal(claims,0);
  assert.equal(productionDb.prepare('SELECT status FROM group_access WHERE chat_id=?').get(stranger).status,'pending');// registered for approval
  await post(stranger,'KB','s2');assert.equal(sent.length,2);assert.equal(claims,0);// still blocked
  await post(owner,'KB','o1');// allowed user proceeds to normal handling (the stub store then aborts)
  assert.equal(claims,1);assert.equal(sent.length,2);
  // The pending person shows on the admin card and can be approved with the usual password flow.
  const mgmt=createSql({DATABASE_BACKEND:'d1',BOSS_DB:env.PRODUCTION_BOSS_DB}),adminCtx={userId:owner,sourceType:'user'};
  const card=JSON.stringify(await processGroupAccessCommand('群組管理',owner,env,createSql(env),new Date(),adminCtx,mgmt));
  assert.match(card,new RegExp(`授權群組 ${stranger}`));assert.match(card,/私訊申請/);
  await processGroupAccessCommand(`授權群組 ${stranger}`,owner,env,createSql(env),new Date(),adminCtx,mgmt);
  assert.match((await processGroupAccessCommand('owner-secret',owner,env,createSql(env),new Date(),adminCtx,mgmt)).text,/已授權/);
  await post(stranger,'KB','s3');assert.equal(claims,2);assert.equal(sent.length,2);// approved person now gets normal handling
 }finally{db.close();productionDb.close();}
});

test('approved private users are not counted as groups',async()=>{
 const {db,productionDb,env,sql,managementSql}=setup();try{
  const user='U'+'b'.repeat(32);
  productionDb.prepare("INSERT INTO group_access(chat_id,status,requested_at) VALUES(?,?,?)").run('C'+'1'.repeat(32),'approved',now.toISOString());
  productionDb.prepare("INSERT INTO group_access(chat_id,status,requested_at) VALUES(?,?,?)").run(user,'approved',now.toISOString());
  const reply=await processGroupAccessCommand('授權群組數',user,env,sql,now,{sourceType:'user',userId:user},managementSql);
  assert.match(reply.text,/：1 個群組/);
 }finally{db.close();productionDb.close();}
});
