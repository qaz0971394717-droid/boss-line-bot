import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {parseReminder,calendarUrl} from '../src/calendar.js';import {runCommand,knownCommand,itemCard} from '../src/commands.js';import {createWorker} from '../src/index.js';
const owner='U'+'1'.repeat(32),other='U'+'2'.repeat(32);
function fixture(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));const binding={prepare(sql){const make=p=>({async all(){return {success:true,results:db.prepare(sql).all(...p)};},async first(){return db.prepare(sql).get(...p);},async run(){return db.prepare(sql).run(...p);}});return {...make([]),bind(...p){return make(p);}};}};return {db,binding};}
test('Taipei reminder parsing validates leap days, month end, clocks and expired inputs',()=>{
 const now=new Date('2026-10-17T23:30:00Z');assert.equal(parseReminder('提醒 明天 15:00 帶硬碟',now).dueAt,'2026-10-19T07:00:00.000Z');
 for(const input of ['提醒 2027-02-29 15:00 無效','提醒 明天 24:00 無效','提醒 今天 01:00 過期','提醒 2026-13-01 15:00 無效'])assert.ok(parseReminder(input,now).error,input);
 assert.equal(parseReminder('提醒 2028-02-29 09:00 有效',now).dueAt,'2028-02-29T01:00:00.000Z');
 const next=parseReminder('提醒 明天 10:00 跨年',new Date('2026-12-31T04:00:00Z'));assert.equal(next.dueAt,'2027-01-01T02:00:00.000Z');
});
test('calendar links preserve punctuation and encode one event at the correct UTC time',()=>{
 const u=new URL(calendarUrl({id:5,content:'維修 & 檢查 #1 / 中文',due_at:'2026-10-18T07:00:00Z'}));assert.equal(u.origin,'https://calendar.google.com');assert.equal(u.searchParams.get('text'),'維修 & 檢查 #1 / 中文');assert.equal(u.searchParams.get('dates'),'20261018T070000Z/20261018T073000Z');assert.equal(u.searchParams.get('ctz'),'Asia/Taipei');
});
test('notes, tasks, searches and item operations stay owner-scoped and repeat inserts are idempotent',async()=>{
 const {db,binding}=fixture();let n=0;const run=(s,who=owner,id)=>runCommand(s,{db:binding,owner:who,eventId:id||String(++n),now:new Date('2026-10-17T04:00:00Z')});try{
 await run('備忘 DL380 主板 P11782-001',owner,'same');await run('備忘 DL380 主板 P11782-001',owner,'same');assert.equal(db.prepare('SELECT count(*) n FROM memo_items').get().n,1);
 assert.match((await run('查備忘 DL380')).text,/P11782-001/);assert.match((await run('查看 1',other)).text,/找不到/);assert.match((await run('刪除 1',other)).text,/找不到/);
 await run('待辦 買硬碟');const taskId=db.prepare("SELECT id FROM memo_items WHERE kind='task'").get().id;assert.match((await run('今天待辦')).text,/買硬碟/);assert.match((await run('完成 '+taskId)).text,/已完成/);assert.match((await run('待辦')).text,/沒有/);await run('取消完成 '+taskId);assert.match((await run('待辦')).text,/買硬碟/);
 const reminder=await run('提醒 明天 15:00 帶硬碟');const reminderId=db.prepare("SELECT id FROM memo_items WHERE kind='reminder'").get().id;assert.equal(reminder.type,'flex');assert.equal(reminder.contents.footer.contents[0].action.type,'uri');assert.match((await run('刪除 '+reminderId)).text,/是否刪除/);assert.equal(db.prepare('SELECT deleted_at FROM memo_items WHERE id=?').get(reminderId).deleted_at,null);await run('確認刪除 '+reminderId);assert.match((await run('查看 '+reminderId)).text,/找不到/);
 await run('備忘 100% 完成');assert.match((await run('查備忘 %')).text,/100%/);assert.equal((await run('查備忘 _')).text,'📋 目前沒有符合的紀錄。');
 }finally{db.close();}
});
test('lists page at eight items and retain access to actions',async()=>{const {db,binding}=fixture();try{for(let i=0;i<10;i++)await runCommand('備忘 記錄'+i,{db:binding,owner,eventId:String(i)});const first=await runCommand('備忘列表',{db:binding,owner,eventId:'list'});assert.equal(first.quickReply.items.length,9);assert.equal(first.quickReply.items.at(-1).action.text,'備忘列表 2');const second=await runCommand('備忘列表 2',{db:binding,owner,eventId:'list2'});assert.equal(second.quickReply.items.length,2);}finally{db.close();}});
async function signed(payload,secret='test-secret'){const body=JSON.stringify(payload),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body)))));return new Request('https://memo/callback',{method:'POST',headers:{'x-line-signature':signature},body});}
function event(id='one',user=owner){return {type:'message',timestamp:Date.now(),webhookEventId:id,replyToken:'reply-token',source:{type:'user',userId:user},message:{type:'text',text:'備忘 測試'}};}
test('webhook verifies signatures and filters strangers, groups and ordinary chat before event writes',async()=>{const {db,binding}=fixture();const env={LINE_CHANNEL_SECRET:'test-secret',LINE_CHANNEL_ACCESS_TOKEN:'token',OWNER_LINE_USER_ID:owner,MEMO_DB:binding};let calls=0;const worker=createWorker({fetcher:async()=>{calls++;return new Response('{}');}});try{
 assert.equal((await worker.fetch(new Request('https://memo/callback',{method:'POST',body:'{}'}),env)).status,401);
 const stranger=event('other',other),group=event('group');group.source.type='group';const ordinary=event('ordinary');ordinary.message.text='嗨';assert.equal((await worker.fetch(await signed({events:[stranger,group,ordinary]}),env)).status,200);assert.equal(calls,0);assert.equal(db.prepare('SELECT count(*) n FROM memo_events').get().n,0);
 assert.equal((await worker.fetch(await signed({events:[]}),{LINE_CHANNEL_SECRET:'test-secret'})).status,200);assert.equal((await worker.fetch(await signed({events:[event()]}),{...env,OWNER_LINE_USER_ID:''})).status,503);
 const one=event();let retained;assert.equal((await worker.fetch(await signed({events:[one]}),env,{waitUntil(p){retained=p;}})).status,200);await retained;await worker.fetch(await signed({events:[one]}),env);assert.equal(calls,1);assert.equal(db.prepare('SELECT count(*) n FROM memo_items').get().n,1);
 }finally{db.close();}});
test('reply failure reuses stored reply and pending claims fail closed',async()=>{const {db,binding}=fixture();const env={LINE_CHANNEL_SECRET:'test-secret',LINE_CHANNEL_ACCESS_TOKEN:'token',OWNER_LINE_USER_ID:owner,MEMO_DB:binding};let fail=true;const worker=createWorker({fetcher:async()=>new Response('{}',{status:fail?503:200})});try{const e=event();assert.equal((await worker.fetch(await signed({events:[e]}),env)).status,500);fail=false;assert.equal((await worker.fetch(await signed({events:[e]}),env)).status,200);assert.equal(db.prepare('SELECT count(*) n FROM memo_items').get().n,1);db.prepare("INSERT INTO memo_events VALUES('pending','pending',NULL,?,?)").run(new Date().toISOString(),new Date().toISOString());assert.equal((await worker.fetch(await signed({events:[event('pending')]}),env)).status,500);assert.equal(db.prepare('SELECT count(*) n FROM memo_items').get().n,1);}finally{db.close();}});
test('supported commands and search length reject irrelevant text',()=>{for(const s of ['指令','備忘 電池','提醒 明天 15:00 維修','待辦 2','今天待辦','查看 1'])assert.ok(knownCommand(s),s);assert.ok(!knownCommand('聊天內容'));});

test('reminder cards are concise and deletion offers both choices without immediate changes',async()=>{
 const {db,binding}=fixture();try{
 db.prepare("INSERT INTO memo_items(owner_id,kind,content,due_at,created_at,updated_at,source_event) VALUES(?,'reminder','簡單小卡',?,?,?,'card')").run(owner,new Date(Date.now()+3600000).toISOString(),new Date().toISOString(),new Date().toISOString());
 const item=db.prepare('SELECT * FROM memo_items').get();const card=itemCard(item,true);
 assert.deepEqual(card.contents.footer.contents.map(b=>b.action.label),['確認新增至日曆','刪除']);
 const menu=await runCommand('刪除 1',{db:binding,owner,eventId:'menu'});
 assert.deepEqual(menu.quickReply.items.map(b=>b.action.label),['只刪備忘','備忘＋日曆一起刪','取消']);assert.equal(db.prepare('SELECT deleted_at FROM memo_items').get().deleted_at,null);
 assert.match((await runCommand('取消刪除 1',{db:binding,owner,eventId:'cancel'})).text,/已取消/);
 await runCommand('確認刪除 1',{db:binding,owner,eventId:'note-only'});
 assert.ok(db.prepare('SELECT deleted_at FROM memo_items').get().deleted_at);
 assert.ok(knownCommand('連同日曆刪除 1'));
 }finally{db.close();}
});

test('help shows concise everyday examples and three read-only shortcuts',async()=>{
 const {db,binding}=fixture();try{
 const help=await runCommand('指令',{db:binding,owner,eventId:'help',env:{GOOGLE_CLIENT_ID:'configured',GOOGLE_CLIENT_SECRET:'configured',GOOGLE_TOKEN_KEY:'configured'}});
 assert.match(help.text,/備忘 買牛奶/);assert.match(help.text,/明天下午3點提醒我拿包裹/);
 assert.ok(!/DL380|P11782|完成 編號|刪除 編號|Google 授權|2026-10-20/.test(help.text));
 assert.ok(help.text.length<200);assert.deepEqual(help.quickReply.items.map(x=>x.action.text),['今天待辦','待辦','備忘列表']);
 assert.equal(db.prepare('SELECT count(*) n FROM memo_items').get().n,0);
 }finally{db.close();}
});

test('natural reminders accept common Chinese phrasing without losing title text',()=>{
 const now=new Date('2026-10-17T04:47:00Z');
 const cases=[
 ['提醒 明天下午3點要去考HPE6 A85考試','2026-10-18T07:00:00.000Z','要去考HPE6 A85考試'],
 ['明天下午三點提醒我拿包裹','2026-10-18T07:00:00.000Z','拿包裹'],
 ['提醒我明天早上九點半去維修','2026-10-18T01:30:00.000Z','去維修'],
 ['10/20 下午3:30 拿包裹','2026-10-20T07:30:00.000Z','拿包裹'],
 ['2026/10/20 09:30 客戶維修','2026-10-20T01:30:00.000Z','客戶維修'],
 ['下週一早上9點開會','2026-10-19T01:00:00.000Z','開會'],
 ['下禮拜一早上9點開會','2026-10-19T01:00:00.000Z','開會'],
 ['10分鐘後提醒我買牛奶','2026-10-17T04:57:00.000Z','買牛奶'],
 ['提醒半小時後拿包裹','2026-10-17T05:17:00.000Z','拿包裹'],
 ['明天下午三點十五分考試','2026-10-18T07:15:00.000Z','考試'],
 ['提醒明天下午３點半 HPE6 A85','2026-10-18T07:30:00.000Z','HPE6 A85'],
 ['10月20日中午12點聚餐','2026-10-20T04:00:00.000Z','聚餐']
 ];
 for(const [input,due,content] of cases){assert.ok(knownCommand(input),input);assert.deepEqual(parseReminder(input,now),{content,dueAt:due},input);}
});
test('ambiguous and invalid natural dates ask for clarification rather than guessing',()=>{
 const now=new Date('2026-10-17T04:47:00Z');
 for(const input of ['明天3點考試','明天買牛奶','明天下午3點','2月30日下午3點考試','明天下午3點70分考試','明天晚上12點拿包裹','提醒 每天 15:00 吃藥','提醒 0分鐘後 拿包裹'])assert.ok(parseReminder(input,now).error,input);
 assert.equal(parseReminder('下週一早上9點開會',new Date('2026-10-19T04:00:00Z')).dueAt,'2026-10-26T01:00:00.000Z');
 assert.ok(parseReminder('1/1 下午3點跨年',now).error);
});
test('natural note and query aliases work and reminder text produces one review card',async()=>{
 const {db,binding}=fixture();let id=0;
 const run=input=>runCommand(input,{db:binding,owner,eventId:'natural-'+(++id),now:new Date('2026-10-17T04:47:00Z')});
 try{
 assert.ok(knownCommand('幫我記一下買牛奶'));await run('幫我記一下買牛奶');
 assert.match((await run('搜尋牛奶')).text,/買牛奶/);assert.match((await run('我的筆記')).text,/買牛奶/);
 await run('待辦去郵局');assert.match((await run('今天有什麼事')).text,/去郵局/);
 const card=await run('提醒 明天下午3點要去考HPE6 A85考試');assert.equal(card.type,'flex');
 const reminder=db.prepare("SELECT content,due_at FROM memo_items WHERE kind='reminder'").get();assert.equal(reminder.content,'要去考HPE6 A85考試');assert.equal(reminder.due_at,'2026-10-18T07:00:00.000Z');
 const count=db.prepare('SELECT count(*) n FROM memo_items').get().n;const error=await run('明天3點考試');assert.match(error.text,/早上／下午/);assert.equal(db.prepare('SELECT count(*) n FROM memo_items').get().n,count);
 }finally{db.close();}
});
