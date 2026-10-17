import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {GOOGLE_SCHEMA,GOOGLE_SCOPE,seal,unseal,googleRoute,linkCalendar,addCalendarEvent,deleteCalendarAndMemo,setNoticeMinutes,digest,calendarItems,previewCalendarClear,confirmCalendarClear,cancelCalendarClear,eventHasEnded} from '../src/google.js';
const owner='U'+'1'.repeat(32),origin='https://hongzhe-personal-memo.qaz0971394717.workers.dev';
function fixture(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));db.exec(GOOGLE_SCHEMA);const binding={prepare(sql){const make=p=>({async all(){return {success:true,results:db.prepare(sql).all(...p)};},async first(){return db.prepare(sql).get(...p);},async run(){return db.prepare(sql).run(...p);}});return {...make([]),bind(...p){return make(p);}};}};return {db,env:{MEMO_DB:binding,OWNER_LINE_USER_ID:owner,GOOGLE_CLIENT_ID:'fake-client',GOOGLE_CLIENT_SECRET:'fake-client-secret',GOOGLE_TOKEN_KEY:Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')}};}
test('OAuth credentials are encrypted with authenticated encryption and wrong keys fail',async()=>{const {db,env}=fixture();try{const encoded=await seal({refreshToken:'private-refresh'},env);assert.ok(!encoded.includes('private-refresh'));assert.deepEqual(await unseal(encoded,env),{refreshToken:'private-refresh'});await assert.rejects(unseal(encoded,{...env,GOOGLE_TOKEN_KEY:Buffer.alloc(32).toString('base64url')}));}finally{db.close();}});
test('OAuth requires owner-issued single-use ticket, same-browser cookie, PKCE and minimal scope',async()=>{const {db,env}=fixture();try{
 assert.equal((await googleRoute(new Request(origin+'/google/start'),{})).status,503);
 const link=await linkCalendar(env,owner),start=new Request(link.quickReply.items[0].action.uri);const redirect=await googleRoute(start,env);assert.equal(redirect.status,302);const target=new URL(redirect.headers.get('Location'));assert.equal(target.searchParams.get('scope'),GOOGLE_SCOPE);assert.equal(target.searchParams.get('code_challenge_method'),'S256');assert.equal(target.searchParams.get('access_type'),'offline');assert.equal((await googleRoute(start,env)).status,400);
 const state=target.searchParams.get('state'),cookie=redirect.headers.get('set-cookie').split(';')[0],callback=origin+'/google/callback?state='+state+'&code=authorization-code';
 assert.equal((await googleRoute(new Request(callback),env)).status,400);assert.equal(db.prepare('SELECT count(*) n FROM google_states').get().n,1);
 let created=0;const fetcher=async(url,options)=>{assert.equal(options.redirect,'manual');if(url.includes('oauth2.googleapis.com')){const body=new URLSearchParams(options.body);assert.ok(body.get('code_verifier'));assert.equal(body.get('code'),'authorization-code');return Response.json({access_token:'access',refresh_token:'refresh-private',scope:GOOGLE_SCOPE});}assert.equal(url,'https://www.googleapis.com/calendar/v3/calendars');assert.equal(JSON.parse(options.body).summary,'弘哲備忘');created++;return Response.json({id:'memo@example.test'});};
 assert.equal((await googleRoute(new Request(callback,{headers:{cookie}}),env,fetcher)).status,200);assert.equal(created,1);assert.ok(!db.prepare('SELECT credentials FROM google_connections').get().credentials.includes('refresh-private'));assert.equal((await googleRoute(new Request(callback,{headers:{cookie}}),env,fetcher)).status,400);
 }finally{db.close();}});
test('cancelled, expired or insufficient-scope OAuth never creates a connection',async()=>{const {db,env}=fixture();try{
 let link=await linkCalendar(env,owner);db.exec('UPDATE google_tickets SET expires_at=0');assert.equal((await googleRoute(new Request(link.quickReply.items[0].action.uri),env)).status,400);
 link=await linkCalendar(env,owner);const response=await googleRoute(new Request(link.quickReply.items[0].action.uri),env);const state=new URL(response.headers.get('Location')).searchParams.get('state'),cookie=response.headers.get('set-cookie').split(';')[0];assert.equal((await googleRoute(new Request(origin+'/google/callback?state='+state+'&error=access_denied',{headers:{cookie}}),env)).status,400);assert.equal(db.prepare('SELECT count(*) n FROM google_connections').get().n,0);
 }finally{db.close();}});
test('event creation is owner-scoped and recovers an uncertain response without a duplicate',async()=>{const {db,env}=fixture();try{
 await db.prepare('INSERT INTO google_connections VALUES(?,?,?,?)').run(owner,'memo@example.test',await seal({refreshToken:'refresh'},env),new Date().toISOString());
 db.prepare("INSERT INTO memo_items(owner_id,kind,content,due_at,created_at,updated_at,source_event) VALUES(?,'reminder','帶硬碟',?,?,?,'one')").run(owner,new Date(Date.now()+3600000).toISOString(),new Date().toISOString(),new Date().toISOString());
 let posts=0,saved;const fetcher=async(url,options)=>{if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'access'});if(options.method==='POST'){posts++;saved=JSON.parse(options.body);assert.equal(saved.reminders.overrides[0].minutes,10);assert.equal(saved.reminders.useDefault,false);assert.equal(saved.attendees,undefined);throw Error('response lost after Google accepted');}return Response.json(saved);};
 assert.match((await addCalendarEvent(env,'U'+'2'.repeat(32),1,fetcher)).text,/不存在/);assert.match((await addCalendarEvent(env,owner,1,fetcher)).text,/尚未確認/);assert.equal(posts,1);assert.equal(db.prepare('SELECT state FROM memo_calendar_events').get().state,'pending');
 assert.match((await addCalendarEvent(env,owner,1,fetcher)).text,/已加入/);assert.equal(posts,1);assert.match((await addCalendarEvent(env,owner,1,fetcher)).text,/不會重複/);assert.equal(posts,1);
 }finally{db.close();}});

async function deletionFixture(){
 const {db,env}=fixture();
 db.prepare('INSERT INTO google_connections VALUES(?,?,?,?)').run(owner,'memo@example.test',await seal({refreshToken:'refresh'},env),new Date().toISOString());
 db.prepare("INSERT INTO memo_items(owner_id,kind,content,due_at,created_at,updated_at,source_event) VALUES(?,'reminder','測試刪除',?,?,?,'delete-test')").run(owner,new Date(Date.now()+3600000).toISOString(),new Date().toISOString(),new Date().toISOString());
 db.prepare("INSERT INTO memo_calendar_events VALUES(1,'memo@example.test','memo123','added')").run();
 return {db,env};
}
test('calendar delete verifies the exact mapped event, owner and memo marker before deleting',async()=>{
 const {db,env}=await deletionFixture();let removed=0;
 try{
 const fetcher=async(url,options)=>{
  if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'access'});
  if(options.method==='DELETE'){removed++;assert.ok(url.endsWith('/calendars/memo%40example.test/events/memo123?sendUpdates=none'));assert.equal(options.headers['If-Match'],'version1');return new Response(null,{status:204});}
  return Response.json({etag:'version1',extendedProperties:{private:{memoId:'1',memoOwner:await (await import('../src/google.js')).digest(owner)}}});
 };
 assert.match((await deleteCalendarAndMemo(env,'U'+'2'.repeat(32),1,fetcher)).text,/不存在/);assert.equal(removed,0);
 assert.match((await deleteCalendarAndMemo(env,owner,1,fetcher)).text,/已刪除/);assert.equal(removed,1);assert.ok(db.prepare('SELECT deleted_at FROM memo_items').get().deleted_at);
 assert.match((await deleteCalendarAndMemo(env,owner,1,fetcher)).text,/已刪除/);assert.equal(removed,1);
 }finally{db.close();}
});
test('Google authorization errors and foreign event markers preserve the note',async()=>{
 for(const mode of ['authorization','foreign','timeout','attendees']){
 const {db,env}=await deletionFixture();let removed=0;try{
 const fetcher=async(url,options)=>{
  if(url.includes('oauth2.googleapis.com'))return mode==='authorization'?new Response('{}',{status:400}):Response.json({access_token:'access'});
  if(options.method==='DELETE'){removed++;throw Error('unknown deletion response');}
  const ownerKey=await (await import('../src/google.js')).digest(owner);
  return Response.json({attendees:mode==='attendees'?[{email:'guest@example.test'}]:undefined,extendedProperties:{private:{memoId:mode==='foreign'?'999':'1',memoOwner:ownerKey}}});
 };
 const reply=await deleteCalendarAndMemo(env,owner,1,fetcher);assert.ok(/保留|未刪除/.test(reply.text),mode);
 assert.equal(db.prepare('SELECT deleted_at FROM memo_items').get().deleted_at,null);
 if(mode!=='timeout')assert.equal(removed,0);
 }finally{db.close();}
 }
});
test('an already absent event is resolved without deleting unrelated data',async()=>{
 const {db,env}=await deletionFixture();let deletes=0;try{
 const fetcher=async(url,options)=>{
  if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'access'});
  if(options.method==='DELETE'){deletes++;throw Error('should not delete');}
  return url.includes('/events/')?new Response('{}',{status:404}):Response.json({id:'memo@example.test'});
 };
 assert.match((await deleteCalendarAndMemo(env,owner,1,fetcher)).text,/已刪除/);assert.equal(deletes,0);
 }finally{db.close();}
});
test('concurrent add and delete operations for one item cannot interleave',async()=>{
 const {db,env}=await deletionFixture();try{
 db.prepare("INSERT INTO memo_calendar_locks VALUES(1,'busy',?)").run(Date.now()+120000);
 const never=async()=>{throw Error('must not call Google while locked');};
 assert.match((await deleteCalendarAndMemo(env,owner,1,never)).text,/正在處理/);
 assert.match((await addCalendarEvent(env,owner,1,never)).text,/正在處理/);
 assert.equal(db.prepare('SELECT deleted_at FROM memo_items').get().deleted_at,null);
 }finally{db.close();}
});

test('near-term reminders notify at event time rather than at an already-past ten-minute offset',async()=>{
 const {db,env}=fixture();try{
 db.prepare('INSERT INTO google_connections VALUES(?,?,?,?)').run(owner,'memo@example.test',await seal({refreshToken:'refresh'},env),new Date().toISOString());
 db.prepare("INSERT INTO memo_items(owner_id,kind,content,due_at,created_at,updated_at,source_event) VALUES(?,'reminder','三分鐘後提醒',?,?,?,'near')").run(owner,new Date(Date.now()+180000).toISOString(),new Date().toISOString(),new Date().toISOString());
 const fetcher=async(url,options)=>{if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'access'});const data=JSON.parse(options.body);assert.equal(data.reminders.overrides[0].minutes,0);return Response.json({id:data.id});};
 assert.match((await addCalendarEvent(env,owner,1,fetcher)).text,/準時/);
 }finally{db.close();}
});

test('notice settings validate offsets and preserve other owners and existing dates',async()=>{
 const {db,env}=await deletionFixture();try{
 db.exec("DELETE FROM memo_calendar_events;UPDATE memo_items SET due_at='"+new Date(Date.now()+3*86400000).toISOString()+"'");
 const due=db.prepare('SELECT due_at FROM memo_items').get().due_at;
 const never=async()=>{throw Error('local selection must not contact Google');};
 assert.match((await setNoticeMinutes(env,'U'+'2'.repeat(32),1,60,never)).text,/不存在/);
 for(const minutes of [0,10,30,60,1440,45]){
  assert.match((await setNoticeMinutes(env,owner,1,minutes,never)).text,/已設為/);
  assert.equal(db.prepare('SELECT notice_minutes FROM memo_items').get().notice_minutes,minutes);
  assert.equal(db.prepare('SELECT due_at FROM memo_items').get().due_at,due);
 }
 for(const minutes of [-1,10081,1.5]){
  assert.match((await setNoticeMinutes(env,owner,1,minutes,never)).text,/0～10080/);
  assert.equal(db.prepare('SELECT notice_minutes FROM memo_items').get().notice_minutes,45);
 }
 db.prepare('UPDATE memo_items SET due_at=?').run(new Date(Date.now()+1800000).toISOString());
 assert.match((await setNoticeMinutes(env,owner,1,60,never)).text,/已經過了/);
 assert.equal(db.prepare('SELECT notice_minutes FROM memo_items').get().notice_minutes,45);
 }finally{db.close();}
});
test('chosen lead time is used at Google creation and stale choices do not create pending mappings',async()=>{
 const {db,env}=await deletionFixture();try{
 db.exec('DELETE FROM memo_calendar_events');
 db.prepare('UPDATE memo_items SET due_at=?,notice_minutes=60').run(new Date(Date.now()+3*3600000).toISOString());
 let posts=0;
 const fetcher=async(url,options)=>{
  if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'access'});
  posts++;const payload=JSON.parse(options.body);assert.equal(payload.reminders.overrides[0].minutes,60);
  assert.equal(payload.start.dateTime,db.prepare('SELECT due_at FROM memo_items').get().due_at);
  return Response.json({id:payload.id});
 };
 assert.match((await addCalendarEvent(env,owner,1,fetcher)).text,/提前1小時/);assert.equal(posts,1);
 db.exec('DELETE FROM memo_calendar_events');
 db.prepare('UPDATE memo_items SET due_at=?').run(new Date(Date.now()+1800000).toISOString());
 assert.match((await addCalendarEvent(env,owner,1,fetcher)).text,/已經過了/);
 assert.equal(db.prepare('SELECT count(*) n FROM memo_calendar_events').get().n,0);assert.equal(posts,1);
 }finally{db.close();}
});
test('existing calendar notice updates only reminders after verifying ownership and etag',async()=>{
 const {db,env}=await deletionFixture();try{
 db.prepare('UPDATE memo_items SET due_at=?').run(new Date(Date.now()+3*3600000).toISOString());
 const due=db.prepare('SELECT due_at FROM memo_items').get().due_at;let patches=0;
 const fetcher=async(url,options)=>{
  if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'access'});
  if(options.method==='PATCH'){
   patches++;assert.ok(url.endsWith('/events/memo123?sendUpdates=none'));assert.equal(options.headers['If-Match'],'version1');
   assert.deepEqual(JSON.parse(options.body),{reminders:{useDefault:false,overrides:[{method:'popup',minutes:60}]}});
   return Response.json({id:'memo123'});
  }
  assert.equal(options.method,undefined);
  return Response.json({etag:'version1',extendedProperties:{private:{memoId:'1',memoOwner:await digest(owner)}}});
 };
 assert.match((await setNoticeMinutes(env,owner,1,60,fetcher)).text,/已同步更新/);assert.equal(patches,1);
 assert.equal(db.prepare('SELECT notice_minutes FROM memo_items').get().notice_minutes,60);
 assert.equal(db.prepare('SELECT due_at FROM memo_items').get().due_at,due);
 }finally{db.close();}
});
test('foreign events, Google failures and unresolved adds never claim updated notices',async()=>{
 for(const mode of ['foreign','authorization','precondition','timeout','pending']){
 const {db,env}=await deletionFixture();try{
 db.prepare('UPDATE memo_items SET due_at=?,notice_minutes=10').run(new Date(Date.now()+3*3600000).toISOString());
 if(mode==='pending')db.exec("UPDATE memo_calendar_events SET state='pending'");
 let patches=0;
 const fetcher=async(url,options)=>{
  if(mode==='pending')throw Error('unresolved add must not send requests');
  if(url.includes('oauth2.googleapis.com'))return mode==='authorization'?new Response('{}',{status:400}):Response.json({access_token:'access'});
  if(options.method==='PATCH'){patches++;if(mode==='timeout')throw Error('response lost');return new Response('{}',{status:412});}
  return Response.json({etag:'v1',extendedProperties:{private:{memoId:mode==='foreign'?'999':'1',memoOwner:await digest(owner)}}});
 };
 const result=await setNoticeMinutes(env,owner,1,60,fetcher);assert.ok(!result.text.startsWith('✅'),mode);
 assert.equal(db.prepare('SELECT notice_minutes FROM memo_items').get().notice_minutes,10);
 if(['foreign','authorization','pending'].includes(mode))assert.equal(patches,0);
 }finally{db.close();}
 }
});

async function calendarManagementFixture(){
 const {db,env}=await deletionFixture(),ownerKey=await digest(owner);
 let deleted=[],failIds=new Set(),foreignIds=new Set(),futureIds=new Set(),versions=new Map(),calls=0;
 const fetcher=async(url,options)=>{
  calls++;
  if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'access'});
  const id=decodeURIComponent(url.split('/events/')[1]?.split('?')[0]||'');
  if(options.method==='DELETE'){
   if(failIds.has(id))return new Response('{}',{status:503});
   assert.equal(options.headers['If-Match'],versions.get(id)||'v1');deleted.push(id);return new Response(null,{status:204});
  }
  const memo=db.prepare('SELECT item_id FROM memo_calendar_events WHERE event_id=?').get(id);
  if(!memo)return new Response('{}',{status:404});
  return Response.json({summary:'日曆實際標題 '+memo.item_id,etag:versions.get(id)||'v1',
   start:{dateTime:new Date(Date.now()-3600000).toISOString()},
   end:{dateTime:new Date(Date.now()+(futureIds.has(id)?3600000:-1800000)).toISOString()},
   extendedProperties:{private:{memoId:String(memo.item_id),memoOwner:foreignIds.has(id)?'foreign':ownerKey}}});
 };
 function insert(id,who=owner){
  db.prepare("INSERT INTO memo_items(id,owner_id,kind,content,due_at,created_at,updated_at,source_event) VALUES(?,?,'reminder',?,?,?,?,?)").run(id,who,'行程'+id,new Date(Date.now()+3600000).toISOString(),new Date().toISOString(),new Date().toISOString(),'calendar-'+id);
  db.prepare("INSERT INTO memo_calendar_events VALUES(?,'memo@example.test',?,'added')").run(id,'memo'+id);
 }
 return {db,env,fetcher,deleted,failIds,foreignIds,futureIds,versions,insert,getCalls:()=>calls};
}
const clearToken=preview=>preview.quickReply.items[0].action.data.split(':')[2];
test('calendar menus show real event state and never delete while listing or previewing',async()=>{
 const f=await calendarManagementFixture();try{
 f.insert(2);f.futureIds.add('memo2');f.insert(3,'U'+'2'.repeat(32));
 const list=await calendarItems(f.env,owner,false,1,f.fetcher);
 assert.match(list.text,/日曆實際標題 1/);assert.ok(!list.text.includes('#3 '));
 const ended=await calendarItems(f.env,owner,true,1,f.fetcher);assert.match(ended.text,/#1/);assert.ok(!ended.text.includes('#2 '));
 const preview=await previewCalendarClear(f.env,owner,'ended',f.fetcher);
 assert.match(preview.text,/#1/);assert.ok(!preview.text.includes('#2 '));assert.equal(f.deleted.length,0);
 assert.equal(f.db.prepare('SELECT deleted_at FROM memo_items WHERE id=1').get().deleted_at,null);
 assert.equal(eventHasEnded({end:{dateTime:new Date(Date.now()+100000).toISOString()}}),false);
 assert.equal(eventHasEnded({end:{dateTime:new Date(Date.now()-100000).toISOString()},recurrence:['RRULE:FREQ=DAILY']}),false);
 }finally{f.db.close();}
});
test('calendar-only clear requires the exact owner, one-use confirmation and leaves notes intact',async()=>{
 const f=await calendarManagementFixture();try{
 const preview=await previewCalendarClear(f.env,owner,1,f.fetcher),token=clearToken(preview);
 assert.match((await confirmCalendarClear(f.env,'U'+'2'.repeat(32),token,f.fetcher)).text,/逾時/);assert.equal(f.deleted.length,0);
 const result=await confirmCalendarClear(f.env,owner,token,f.fetcher);assert.match(result.text,/日曆行程已刪除/);assert.deepEqual(f.deleted,['memo123']);
 assert.equal(f.db.prepare('SELECT deleted_at FROM memo_items').get().deleted_at,null);
 assert.equal(f.db.prepare('SELECT state FROM memo_calendar_events').get().state,'deleted');
 assert.match((await confirmCalendarClear(f.env,owner,token,f.fetcher)).text,/已使用/);assert.equal(f.deleted.length,1);
 }finally{f.db.close();}
});
test('cancelled and expired confirmations cannot clear events, and previews replace older requests',async()=>{
 const f=await calendarManagementFixture();try{
 let token=clearToken(await previewCalendarClear(f.env,owner,'all',f.fetcher));
 await cancelCalendarClear(f.env,owner);assert.match((await confirmCalendarClear(f.env,owner,token,f.fetcher)).text,/取消/);
 token=clearToken(await previewCalendarClear(f.env,owner,'all',f.fetcher));f.db.exec('UPDATE memo_calendar_confirmations SET expires_at=0');
 assert.match((await confirmCalendarClear(f.env,owner,token,f.fetcher)).text,/逾時/);
 const old=clearToken(await previewCalendarClear(f.env,owner,'all',f.fetcher));
 const fresh=clearToken(await previewCalendarClear(f.env,owner,'all',f.fetcher));
 assert.notEqual(old,fresh);assert.match((await confirmCalendarClear(f.env,owner,old,f.fetcher)).text,/已使用/);
 assert.equal(f.deleted.length,0);
 }finally{f.db.close();}
});
test('batch clear is bounded, reports partial failures and never deletes future ended-only events',async()=>{
 const f=await calendarManagementFixture();try{
 for(const id of [2,3,4,5])f.insert(id);
 f.futureIds.add('memo2');f.failIds.add('memo3');
 const preview=await previewCalendarClear(f.env,owner,'ended',f.fetcher);
 assert.match(preview.text,/以下 3 筆/);assert.ok(!preview.text.includes('#2 '));
 const result=await confirmCalendarClear(f.env,owner,clearToken(preview),f.fetcher);
 assert.match(result.text,/尚未確認/);assert.equal(f.deleted.length,2);assert.ok(!f.deleted.includes('memo2'));assert.ok(!f.deleted.includes('memo5'));
 assert.equal(f.db.prepare("SELECT count(*) n FROM memo_items WHERE deleted_at IS NOT NULL").get().n,0);
 assert.equal(f.db.prepare('SELECT state FROM memo_calendar_events WHERE item_id=3').get().state,'added');
 }finally{f.db.close();}
});
test('modified, moved or foreign events are preserved after a clear preview',async()=>{
 for(const mode of ['etag','future','foreign','mapping']){
 const f=await calendarManagementFixture();try{
 const preview=await previewCalendarClear(f.env,owner,'ended',f.fetcher);
 if(mode==='etag')f.versions.set('memo123','v2');
 if(mode==='future'){f.futureIds.add('memo123');/* even unchanged fake etag must recheck actual end */}
 if(mode==='foreign')f.foreignIds.add('memo123');
 if(mode==='mapping')f.db.exec("UPDATE memo_calendar_events SET event_id='replacement'");
 const result=await confirmCalendarClear(f.env,owner,clearToken(preview),f.fetcher);
 assert.ok(!result.text.includes('✅'),mode);assert.equal(f.deleted.length,0,mode);
 assert.equal(f.db.prepare('SELECT deleted_at FROM memo_items').get().deleted_at,null);
 }finally{f.db.close();}
 }
});
test('calendar entry can be removed after local note deletion, without resurrecting the note',async()=>{
 const f=await calendarManagementFixture();try{
 const stamp=new Date().toISOString();f.db.prepare('UPDATE memo_items SET deleted_at=?').run(stamp);
 const preview=await previewCalendarClear(f.env,owner,1,f.fetcher);
 assert.match((await confirmCalendarClear(f.env,owner,clearToken(preview),f.fetcher)).text,/日曆行程已刪除/);
 assert.equal(f.db.prepare('SELECT deleted_at FROM memo_items').get().deleted_at,stamp);
 }finally{f.db.close();}
});
