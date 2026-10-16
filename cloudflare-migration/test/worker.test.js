import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { formatDiscordKb, createWorker } from '../src/index.js';

const enabledEnv = { STAGING_MODE: 'true', ENABLE_STAGING_LINE: 'true', STAGING_DATABASE_URL: 'isolated-test', LINE_CHANNEL_ACCESS_TOKEN: 'test-token', LINE_CHANNEL_SECRET: 'test-secret' };
function memoryEventStore() {
 const records = new Map();
 const delivered = new Set();
 return {
  async claim(id) {
   if (delivered.has(id)) return {state:'done'};
   if (records.has(id)) return records.get(id) ? {state:'ready',reply:records.get(id)} : {state:'pending'};
   records.set(id,null);
   return {state:'new'};
  },
  async complete(id,reply) { records.set(id,reply); },
  async delivered(id) { delivered.add(id); }
 };
}
async function signedRequest(body, env = enabledEnv) {
 const bytes = new TextEncoder();
 const key = await crypto.subtle.importKey('raw', bytes.encode(env.LINE_CHANNEL_SECRET), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
 const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes.encode(body)))));
 return new Request('https://staging.example/callback', {method:'POST',body,headers:{'x-line-signature':signature}});
}

test('slow first database claim is retained after webhook disconnect without duplicate commands', async () => {
 let release, claimed;
 const gate = new Promise(resolve => {release=resolve;});
 const started = new Promise(resolve => {claimed=resolve;});
 const store = memoryEventStore();
 const originalClaim=store.claim;
 store.claim=async id=>{claimed();await gate;return originalClaim(id);};
 let commands=0,replies=0;
 const app=createWorker({eventStoreFactory:()=>store,
  commandHandler:async()=>{commands++;return {type:'text',text:'ok'};},
  fetcher:async()=>{replies++;return new Response(null,{status:200});}
 });
 const retained=[];
 const ctx={waitUntil(promise){assert.equal(this,ctx);retained.push(promise);}};
 const body=JSON.stringify({events:[{type:'message',webhookEventId:'slow-first-event',replyToken:'test-only',source:{groupId:'test-group'},message:{type:'text',text:'KB'}}]});
 const request=await signedRequest(body);
 const controller=new AbortController();
 const response=app.fetch(new Request(request,{signal:controller.signal}),enabledEnv,ctx);
 await started;
 assert.equal(retained.length,1);
 assert.equal(commands,0);
 controller.abort();
 release();
 assert.equal((await response).status,200);
 assert.equal((await retained[0]).status,200);
 assert.equal((await app.fetch(await signedRequest(body),enabledEnv,ctx)).status,200);
 assert.equal(commands,1);
 assert.equal(replies,1);
});

test('retained background lifetime preserves failure status and signature validation',async()=>{
 const retained=[];
 const ctx={waitUntil(p){retained.push(p);}};
 const app=createWorker({eventStoreFactory:()=>memoryEventStore(),commandHandler:async()=>({type:'text',text:'ok'}),fetcher:async()=>new Response(null,{status:503})});
 const body=JSON.stringify({events:[{type:'message',webhookEventId:'reply-failure',replyToken:'test-only',source:{groupId:'test-group'},message:{type:'text',text:'KB'}}]});
 assert.equal((await app.fetch(new Request('https://staging.example/callback',{method:'POST',body}),enabledEnv,ctx)).status,401);
 assert.equal(retained.length,0);
 assert.equal((await app.fetch(await signedRequest(body),enabledEnv,ctx)).status,500);
 assert.equal((await retained[0]).status,500);
});

test('signed LINE batch skips malformed events and isolates a reply failure', async () => {
 const commands = [], replies = [];
 const app = createWorker({
  eventStoreFactory: () => memoryEventStore(),
  commandHandler: async (command, chatId) => { commands.push([command,chatId]); return {type:'text',text:'ok'}; },
  fetcher: async (url, options) => {
   assert.equal(url, 'https://api.line.me/v2/bot/message/reply');
   assert.equal(options.redirect, 'manual');
   assert.ok(options.signal instanceof AbortSignal);
   replies.push(JSON.parse(options.body));
   return new Response(null, {status: replies.length === 1 ? 503 : 200});
  }
 });
 const event = (token, text='K test') => ({type:'message',webhookEventId:token,replyToken:token,source:{groupId:'test-group'},message:{type:'text',text}});
 const body = JSON.stringify({events:[null, {...event('bad'),source:{}}, event('wrong-type',42), event('one'), event('two','KB')]});
 const response = await app.fetch(await signedRequest(body), enabledEnv);
 assert.equal(response.status, 500);
 assert.deepEqual(await response.json(), {processed:2,failed:1});
 assert.deepEqual(commands, [['K test','test-group'],['KB','test-group']]);
 assert.equal(replies.length, 2);
});

test('LINE redelivery reuses the stored reply without repeating a mutation', async () => {
 const store = memoryEventStore();
 let commands = 0, replies = 0;
 const app = createWorker({
  eventStoreFactory: () => store,
  commandHandler: async () => { commands++; return {type:'text',text:'recorded'}; },
  fetcher: async () => new Response(null,{status: ++replies === 1 ? 503 : 200})
 });
 const body = JSON.stringify({events:[{type:'message',webhookEventId:'unique-event',replyToken:'test-reply',source:{groupId:'test-group'},message:{type:'text',text:'K test'}}]});
 assert.equal((await app.fetch(await signedRequest(body),enabledEnv)).status,500);
 assert.equal((await app.fetch(await signedRequest(body),enabledEnv)).status,200);
 assert.equal((await app.fetch(await signedRequest(body),enabledEnv)).status,200);
 assert.equal(commands,1);
 assert.equal(replies,2);
});

test('uncertain command or unavailable event storage fails closed on redelivery', async () => {
 const store = memoryEventStore();
 let commands = 0;
 const app = createWorker({
  eventStoreFactory: () => store,
  commandHandler: async () => { commands++; throw new Error('uncertain commit'); },
  fetcher: async () => assert.fail('must not send a reply')
 });
 const body = JSON.stringify({events:[{type:'message',webhookEventId:'uncertain-event',replyToken:'test-reply',source:{groupId:'test-group'},message:{type:'text',text:'HALF'}}]});
 assert.equal((await app.fetch(await signedRequest(body),enabledEnv)).status,500);
 assert.equal((await app.fetch(await signedRequest(body),enabledEnv)).status,500);
 assert.equal(commands,1);
 const noDatabase = createWorker({eventStoreFactory:()=>({claim:async()=>{throw new Error('DB offline');}}),commandHandler:async()=>assert.fail('must not mutate')});
 assert.equal((await noDatabase.fetch(await signedRequest(body),enabledEnv)).status,500);
});

test('concurrent redelivery cannot run the same command while its first attempt is pending', async () => {
 const store = memoryEventStore();
 let start, finish;
 const started = new Promise(resolve => { start = resolve; });
 const completed = new Promise(resolve => { finish = resolve; });
 let commands = 0;
 const app = createWorker({
  eventStoreFactory: () => store,
  commandHandler: async () => { commands++; start(); await completed; return {type:'text',text:'ok'}; },
  fetcher: async () => new Response(null,{status:200})
 });
 const body = JSON.stringify({events:[{type:'message',webhookEventId:'concurrent-event',replyToken:'test-reply',source:{groupId:'test-group'},message:{type:'text',text:'HALF'}}]});
 const first = app.fetch(await signedRequest(body),enabledEnv);
 await started;
 try {
  assert.equal((await app.fetch(await signedRequest(body),enabledEnv)).status,500);
  assert.equal(commands,1);
 } finally { finish(); }
 assert.equal((await first).status,200);
});

test('failure to persist a reply never replays an already executed command', async () => {
 const store = memoryEventStore();
 store.complete = async () => { throw new Error('DB write failed'); };
 let commands = 0;
 const app = createWorker({
  eventStoreFactory: () => store,
  commandHandler: async () => { commands++; return {type:'text',text:'ok'}; },
  fetcher: async () => assert.fail('reply must be persisted first')
 });
 const body = JSON.stringify({events:[{type:'message',webhookEventId:'save-failure',replyToken:'test-reply',source:{groupId:'test-group'},message:{type:'text',text:'HALF'}}]});
 assert.equal((await app.fetch(await signedRequest(body),enabledEnv)).status,500);
 assert.equal((await app.fetch(await signedRequest(body),enabledEnv)).status,500);
 assert.equal(commands,1);
});

test('LINE accepts verification batches and rejects invalid signed payloads', async () => {
 for (const body of ['null','{}','{"events":null}']) {
  assert.equal((await worker.fetch(await signedRequest(body),enabledEnv)).status,400);
 }
 const response = await worker.fetch(await signedRequest('{"events":[]}'), enabledEnv);
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{processed:0,failed:0});
});

test('tampering with a signed body never runs commands', async () => {
 const request = await signedRequest('{"events":[]}');
 const tampered = new Request(request.url,{method:'POST',headers:request.headers,body:'{"events":[{}]}'});
 assert.equal((await worker.fetch(tampered,enabledEnv)).status,401);
});

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
