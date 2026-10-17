import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {BIRTHDAY_CHAT_ID,BIRTHDAY_COMMAND,BIRTHDAY_POSTBACK,addBirthdayButton} from '../src/birthday.js';
import {createKbFlex} from '../src/flex.js';
import {handleLineCommand} from '../src/line-commands.js';
import {shouldProcessCommand} from '../src/command-filter.js';
import {createWorker} from '../src/index.js';
import {createProductionWorker} from '../src/production.js';

const enabled={STAGING_MODE:'true',ENABLE_BIRTHDAY_SURPRISE:'true'};
test('birthday button is limited to the enabled target group and preserves KB actions',()=>{
 const original=createKbFlex(Array.from({length:20},(_,i)=>({boss_name:'王'+i,respawn_time:'2026-10-17T09:00:00Z'})));
 const decorated=addBirthdayButton(original,enabled,BIRTHDAY_CHAT_ID);
 assert.ok(JSON.stringify(decorated).includes(BIRTHDAY_COMMAND));
 assert.equal(decorated.contents.contents[0].footer.contents[1].action.data,BIRTHDAY_POSTBACK);
 assert.ok(JSON.stringify(decorated).includes('kbkill:王0'));
 assert.ok(!JSON.stringify(original).includes(BIRTHDAY_COMMAND));
 assert.ok(!JSON.stringify(decorated.contents.contents[1]).includes(BIRTHDAY_COMMAND));
 for(const [env,chat] of [[{},BIRTHDAY_CHAT_ID],[enabled,'another-group'],[{...enabled,PRODUCTION_MODE:'true'},BIRTHDAY_CHAT_ID]]){
  assert.equal(addBirthdayButton(original,env,chat),original);
 }
 const empty=addBirthdayButton(createKbFlex([]),enabled,BIRTHDAY_CHAT_ID);
 assert.equal(empty.type,'text');assert.equal(empty.quickReply.items[0].action.label,BIRTHDAY_COMMAND);
});

test('KB command shows the surprise only in the specified group and greeting changes no boss records',async()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../d1/0001_core.sql',import.meta.url),'utf8'));
 const env={...enabled,DATABASE_BACKEND:'d1',BOSS_DB:{prepare(sql){return {bind(...args){return {async all(){return {success:true,results:db.prepare(sql).all(...args)};}};}};}}};
 try{
  const kb=await handleLineCommand('KB',BIRTHDAY_CHAT_ID,env);
  assert.equal(kb.quickReply.items[0].action.data,BIRTHDAY_POSTBACK);
  assert.ok(!JSON.stringify(await handleLineCommand('KB','other',env)).includes(BIRTHDAY_COMMAND));
  const changes=db.prepare('SELECT total_changes() n').get().n;
  const greeting=await handleLineCommand(BIRTHDAY_COMMAND,BIRTHDAY_CHAT_ID,env);
  assert.match(greeting.text,/多多綠大姊，生日快樂/);assert.ok(greeting.text.length<500);
  assert.equal(await handleLineCommand(BIRTHDAY_COMMAND,'other',env),null);
  assert.equal(await shouldProcessCommand(BIRTHDAY_COMMAND,'other',env,{}),false);
  assert.equal(await shouldProcessCommand(BIRTHDAY_COMMAND,BIRTHDAY_CHAT_ID,env,{}),true);
  assert.equal(db.prepare('SELECT total_changes() n').get().n,changes);
 }finally{db.close();}
});

test('signed birthday postback returns one greeting and ignores other groups',async()=>{
 const env={...enabled,ENABLE_STAGING_LINE:'true',LINE_CHANNEL_SECRET:'test-secret',LINE_CHANNEL_ACCESS_TOKEN:'test-token',DATABASE_BACKEND:'d1',BOSS_DB:{prepare(){throw Error('birthday must not query boss data');}}};
 const delivered=new Set();let replies=0,claims=0;
 const app=createWorker({eventStoreFactory:()=>({async claim(id){claims++;return {state:delivered.has(id)?'done':'new'};},async complete(){},async delivered(id){delivered.add(id);}}),fetcher:async(url,options)=>{
  replies++;assert.equal(url,'https://api.line.me/v2/bot/message/reply');
  const messages=JSON.parse(options.body).messages;assert.equal(messages.length,1);assert.match(messages[0].text,/生日快樂/);return Response.json({});
 }});
 async function request(id,chat){
  const body=JSON.stringify({events:[{type:'postback',webhookEventId:id,replyToken:'reply',timestamp:Date.now(),source:{type:'group',groupId:chat,userId:'tester'},postback:{data:BIRTHDAY_POSTBACK}}]});
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.LINE_CHANNEL_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body)))));
  return new Request('https://staging.test/callback',{method:'POST',body,headers:{'x-line-signature':signature}});
 }
 assert.equal((await app.fetch(await request('other','other-group'),env)).status,200);assert.equal(claims,0);
 assert.equal((await app.fetch(await request('birthday',BIRTHDAY_CHAT_ID),env)).status,200);
 assert.equal((await app.fetch(await request('birthday',BIRTHDAY_CHAT_ID),env)).status,200);
 assert.equal(replies,1);
});

test('production adapter does not forward the staging birthday switch',async()=>{
 let received;
 const app=createProductionWorker({worker:{fetch(request,env){received=env;return new Response('ok');}}});
 await app.fetch(new Request('https://prod.test/callback',{method:'POST'}),{PRODUCTION_MODE:'true',ENABLE_LINE:'true',DATABASE_URL:'production-only',LINE_CHANNEL_SECRET:'secret',LINE_CHANNEL_ACCESS_TOKEN:'token',ENABLE_BIRTHDAY_SURPRISE:'true'});
 assert.equal(received.ENABLE_BIRTHDAY_SURPRISE,undefined);
 assert.ok(!JSON.stringify(addBirthdayButton(createKbFlex([]),received,BIRTHDAY_CHAT_ID)).includes(BIRTHDAY_COMMAND));
});

test('staging private chat can preview birthday KB without joining a group',async()=>{
 const chat='U'+'a'.repeat(32);
 const preview=addBirthdayButton(createKbFlex([]),enabled,chat);
 assert.equal(preview.quickReply.items[0].action.label,BIRTHDAY_COMMAND);
 assert.match((await handleLineCommand(BIRTHDAY_COMMAND,chat,enabled)).text,/生日快樂/);
 assert.equal(await shouldProcessCommand(BIRTHDAY_COMMAND,chat,enabled,{}),true);
 assert.equal(addBirthdayButton(createKbFlex([]),{...enabled,PRODUCTION_MODE:'true'},chat).quickReply,undefined);
 assert.equal(addBirthdayButton(createKbFlex([]),enabled,'Canother-group').quickReply,undefined);
});
