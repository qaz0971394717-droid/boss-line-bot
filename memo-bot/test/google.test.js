import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {GOOGLE_SCHEMA,GOOGLE_SCOPE,seal,unseal,googleRoute,linkCalendar,addCalendarEvent,deleteCalendarAndMemo} from '../src/google.js';
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
 assert.match((await addCalendarEvent(env,owner,1,fetcher)).text,/於開始時間/);
 }finally{db.close();}
});
