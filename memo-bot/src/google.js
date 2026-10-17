import {getNoticeMinutes,noticeLabel,noticeError} from './notice.js';
import {fetchLineReply} from './http.js';
const origin='https://hongzhe-personal-memo.qaz0971394717.workers.dev';
export const GOOGLE_SCOPE='https://www.googleapis.com/auth/calendar.app.created';
export const GOOGLE_SCHEMA=`
CREATE TABLE IF NOT EXISTS google_tickets(hash TEXT PRIMARY KEY,owner_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS google_states(hash TEXT PRIMARY KEY,owner_id TEXT NOT NULL,cookie_hash TEXT NOT NULL,verifier TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS google_ticket_expiry ON google_tickets(expires_at);
CREATE INDEX IF NOT EXISTS google_state_expiry ON google_states(expires_at);
CREATE TABLE IF NOT EXISTS google_connections(owner_id TEXT PRIMARY KEY,calendar_id TEXT NOT NULL,credentials TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memo_calendar_locks(item_id INTEGER PRIMARY KEY,token TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS memo_calendar_confirmations(token TEXT PRIMARY KEY,owner_id TEXT NOT NULL,payload TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS memo_calendar_confirm_expiry ON memo_calendar_confirmations(expires_at);
CREATE TABLE IF NOT EXISTS memo_calendar_events(item_id INTEGER PRIMARY KEY,calendar_id TEXT NOT NULL,event_id TEXT NOT NULL,state TEXT NOT NULL);
`;
const bytes=x=>new TextEncoder().encode(x),q=(db,s,...p)=>db.prepare(s).bind(...p);
const b64=x=>btoa(String.fromCharCode(...x)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const un64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0));
const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
export const digest=async value=>b64(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(value))));
const cryptoKey=env=>crypto.subtle.importKey('raw',un64(env.GOOGLE_TOKEN_KEY),{name:'AES-GCM'},false,['encrypt','decrypt']);
export async function seal(value,env){const nonce=crypto.getRandomValues(new Uint8Array(12));return b64(nonce)+'.'+b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},await cryptoKey(env),bytes(JSON.stringify(value)))));}
export async function unseal(value,env){const [iv,cipher]=value.split('.');return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(iv)},await cryptoKey(env),un64(cipher))));}
const configured=env=>Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.GOOGLE_TOKEN_KEY);
const message=text=>({type:'text',text});
export async function linkCalendar(env,owner){
 if(!configured(env))return message('Google 日曆串接設定尚未完成；先使用原本的日曆連結。');
 const token=random();
 await q(env.MEMO_DB,'DELETE FROM google_tickets WHERE owner_id=?',owner).run();
 await q(env.MEMO_DB,'INSERT INTO google_tickets VALUES(?,?,?)',await digest(token),owner,Date.now()+600000).run();
 return {...message('請用手機 Chrome 開啟下方連結，登入你要使用的 Google 帳號。\n只授權這個程式建立的專用日曆；連結 10 分鐘內有效。'),quickReply:{items:[{type:'action',action:{type:'uri',label:'授權 Google 日曆',uri:origin+'/google/start?ticket='+token+'&openExternalBrowser=1'}}]}};
}
async function googleFetch(url,options={},fetcher=fetch){return fetchLineReply(url,options,fetcher,15000);}
const tokenRequest=(env,params,fetcher)=>googleFetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,...params}).toString()},fetcher);
const calendarApi=(path,access,options={},fetcher)=>googleFetch('https://www.googleapis.com/calendar/v3/'+path,{...options,headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:options.body?JSON.stringify(options.body):undefined},fetcher);
function page(text,status=200,headers={}){return new Response(text,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',...headers}});}
export async function googleRoute(request,env,fetcher=fetch){
 const url=new URL(request.url);if(!url.pathname.startsWith('/google/'))return null;
 if(request.method!=='GET'||!configured(env))return page('Google 日曆串接尚未啟用。',503);
 try{
 if(url.pathname==='/google/start'){
  const ticket=url.searchParams.get('ticket');if(!ticket)return page('請從 LINE 私訊輸入「連結日曆」重新取得連結。',400);
  const result=await q(env.MEMO_DB,'DELETE FROM google_tickets WHERE hash=? AND expires_at>? RETURNING owner_id',await digest(ticket),Date.now()).all();
  if(!result.results.length)return page('連結已使用或逾時，請回 LINE 輸入「連結日曆」。',400);
  const owner=result.results[0].owner_id;if(owner!==env.OWNER_LINE_USER_ID)return page('帳號不符。',403);
  const state=random(),cookie=random(),verifier=random();
  await q(env.MEMO_DB,'INSERT INTO google_states VALUES(?,?,?,?,?)',await digest(state),owner,await digest(cookie),await seal(verifier,env),Date.now()+600000).run();
  const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth');auth.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:origin+'/google/callback',response_type:'code',scope:GOOGLE_SCOPE,state,access_type:'offline',prompt:'consent',code_challenge:await digest(verifier),code_challenge_method:'S256'}).toString();
  return page('正在開啟 Google 授權頁面。',302,{Location:auth.href,'Set-Cookie':`memo_google=${cookie}; HttpOnly; Secure; SameSite=Lax; Path=/google/; Max-Age=600`});
 }
 if(url.pathname==='/google/callback'){
  const state=url.searchParams.get('state'),cookie=request.headers.get('cookie')?.match(/(?:^|;\s*)memo_google=([^;]+)/)?.[1];
  if(!state||!cookie)return page('授權驗證無效。請使用同一個瀏覽器，從 LINE 重新連結。',400);
  const result=await q(env.MEMO_DB,'DELETE FROM google_states WHERE hash=? AND cookie_hash=? AND expires_at>? RETURNING *',await digest(state),await digest(cookie),Date.now()).all();
  const pending=result.results[0];if(!pending||pending.owner_id!==env.OWNER_LINE_USER_ID)return page('授權已失效，請從 LINE 重新連結。',400);
  const code=url.searchParams.get('code');if(!code||url.searchParams.has('error'))return page('已取消授權，備忘功能仍可使用。',400);
  const response=await tokenRequest(env,{grant_type:'authorization_code',code,redirect_uri:origin+'/google/callback',code_verifier:await unseal(pending.verifier,env)},fetcher);
  if(!response.ok)throw Error('Token exchange failed');const token=await response.json();
  if(!token.refresh_token||!String(token.scope||'').split(' ').includes(GOOGLE_SCOPE))throw Error('Offline calendar authorization incomplete');
  const previous=await q(env.MEMO_DB,'SELECT calendar_id FROM google_connections WHERE owner_id=?',pending.owner_id).first();
  let calendarId=previous?.calendar_id;
  if(calendarId){const existing=await calendarApi('calendars/'+encodeURIComponent(calendarId),token.access_token,{},fetcher);if(!existing.ok)return page('這次帳號無法存取先前的專用日曆。請使用原本的 Google 帳號重新授權。',400);}
  else {const created=await calendarApi('calendars',token.access_token,{method:'POST',body:{summary:'弘哲備忘',timeZone:'Asia/Taipei',description:'由個人 LINE 備忘機器人建立的提醒。'}},fetcher);if(!created.ok)throw Error('Calendar creation failed');calendarId=(await created.json()).id;if(!calendarId)throw Error('Calendar ID missing');}
  await q(env.MEMO_DB,'INSERT INTO google_connections VALUES(?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET calendar_id=excluded.calendar_id,credentials=excluded.credentials,updated_at=excluded.updated_at',pending.owner_id,calendarId,await seal({refreshToken:token.refresh_token},env),new Date().toISOString()).run();
  return page('✅ Google 日曆已連結。\n\n請回到 LINE，輸入「日曆狀態」確認。之後提醒卡片點「確認新增至日曆」，即可直接加入，預設提前 10 分鐘通知。\n\n本頁不會自動新增測試行程。',200,{'Set-Cookie':'memo_google=; HttpOnly; Secure; SameSite=Lax; Path=/google/; Max-Age=0'});
 }
 return page('Not Found',404);
 }catch(error){console.error('Google calendar connection failed:',error.name);return page('Google 日曆連結未完成。請確認 API 已啟用、授權設定正確，再回 LINE 輸入「連結日曆」重試。',502);}
}
export async function calendarStatus(env,owner){const connection=await q(env.MEMO_DB,'SELECT calendar_id FROM google_connections WHERE owner_id=?',owner).first();return message(connection?'✅ 已連結專用 Google 日曆「弘哲備忘」。\n新增提醒後，點「確認新增至日曆」即可加入。':'尚未連結 Google 日曆，請輸入「連結日曆」。');}
async function addCalendarEventUnlocked(env,owner,itemId,fetcher=fetch){
 if(!configured(env))return message('Google 串接尚未設定完成。');
 const db=env.MEMO_DB,item=await q(db,'SELECT * FROM memo_items WHERE owner_id=? AND id=? AND deleted_at IS NULL',owner,itemId).first();
 if(!item||!item.due_at)return message('這筆提醒不存在或未設定時間。');
 if(item.status==='done')return message('這筆事項已完成，未新增日曆。');
 const connection=await q(db,'SELECT * FROM google_connections WHERE owner_id=?',owner).first();if(!connection)return linkCalendar(env,owner);
 const mapping=await q(db,'SELECT * FROM memo_calendar_events WHERE item_id=?',itemId).first();
 if(mapping?.state==='added')return message(`✅ #${itemId} 已加入 Google 日曆，不會重複新增。`);
 if(new Date(item.due_at).getTime()<=Date.now())return message('提醒時間已過，未新增日曆。');
 const noticeMinutes=getNoticeMinutes(item);
 const expiredNotice=noticeError(item,noticeMinutes);if(expiredNotice&&!mapping)return message(expiredNotice);
 try{
 const stored=await unseal(connection.credentials,env),r=await tokenRequest(env,{grant_type:'refresh_token',refresh_token:stored.refreshToken},fetcher);if(!r.ok)return message('Google 授權已失效，請輸入「連結日曆」重新授權。');
 const token=await r.json();if(!token.access_token)throw Error('Access token missing');
 const hex=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(owner+':'+itemId)))].map(x=>x.toString(16).padStart(2,'0')).join('');const eventId=mapping?.event_id||'memo'+hex.slice(0,40);
 if(mapping&&mapping.calendar_id!==connection.calendar_id)throw Error('Calendar mapping mismatch');
 await q(db,"INSERT INTO memo_calendar_events VALUES(?,?,?,'pending') ON CONFLICT(item_id) DO NOTHING",itemId,connection.calendar_id,eventId).run();
 const path='calendars/'+encodeURIComponent(connection.calendar_id)+'/events',ownerKey=await digest(owner);
 const event={id:eventId,summary:item.content,start:{dateTime:item.due_at,timeZone:'Asia/Taipei'},end:{dateTime:new Date(new Date(item.due_at).getTime()+1800000).toISOString(),timeZone:'Asia/Taipei'},reminders:{useDefault:false,overrides:[{method:'popup',minutes:noticeMinutes}]},extendedProperties:{private:{memoId:String(itemId),memoOwner:ownerKey}}};
 let accepted=false;
 if(mapping){const existing=await calendarApi(path+'/'+eventId,token.access_token,{},fetcher);if(existing.ok){const data=await existing.json();accepted=data.status!=='cancelled'&&data.extendedProperties?.private?.memoId===String(itemId)&&data.extendedProperties?.private?.memoOwner===ownerKey;if(!accepted)throw Error('Existing event mismatch');}else if(existing.status!==404)throw Error('Event lookup failed');}
 if(!accepted){if(expiredNotice)return message(expiredNotice);const created=await calendarApi(path,token.access_token,{method:'POST',body:event},fetcher);if(created.ok)accepted=true;else if(created.status===409){const existing=await calendarApi(path+'/'+eventId,token.access_token,{},fetcher);if(existing.ok){const data=await existing.json();accepted=data.status!=='cancelled'&&data.extendedProperties?.private?.memoId===String(itemId)&&data.extendedProperties?.private?.memoOwner===ownerKey;}}}
 if(!accepted)throw Error('Calendar event not confirmed');
 await q(db,"UPDATE memo_calendar_events SET state='added' WHERE item_id=? AND event_id=?",itemId,eventId).run();
 return message(`✅ #${itemId} 已加入 Google 日曆，${noticeLabel(noticeMinutes)}通知。\n請確認 Android 允許 Google 日曆通知。`);
 }catch(error){console.error('Google calendar event failed:',error.name);return message('尚未確認日曆新增成功，請稍後再點一次。系統會使用相同事件編號，避免重複新增。');}
}

async function withCalendarLock(env,owner,itemId,operation,includeDeleted=false){
 const item=await q(env.MEMO_DB,'SELECT id FROM memo_items WHERE owner_id=? AND id=?'+(includeDeleted?'':' AND deleted_at IS NULL'),owner,itemId).first();
 if(!item)return message('這筆提醒不存在或已刪除。');
 const token=random(),now=Date.now();
 const locked=await q(env.MEMO_DB,'INSERT INTO memo_calendar_locks VALUES(?,?,?) ON CONFLICT(item_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE memo_calendar_locks.expires_at<? RETURNING token',itemId,token,now+120000,now).all();
 if(!locked.results.length)return message('這筆日曆事項正在處理，請稍後再試。');
 try{return await operation();}
 finally{await q(env.MEMO_DB,'DELETE FROM memo_calendar_locks WHERE item_id=? AND token=?',itemId,token).run();}
}
export async function addCalendarEvent(env,owner,itemId,fetcher=fetch){
 if(!configured(env))return message('Google 串接尚未設定完成。');
 return withCalendarLock(env,owner,itemId,()=>addCalendarEventUnlocked(env,owner,itemId,fetcher));
}
export async function deleteCalendarAndMemo(env,owner,itemId,fetcher=fetch,options={}){
 if(!configured(env))return message('Google 串接尚未設定，備忘未刪除。');
 return withCalendarLock(env,owner,itemId,async()=>{
  const db=env.MEMO_DB;
  const mapping=await q(db,'SELECT * FROM memo_calendar_events WHERE item_id=?',itemId).first();
  if(options.calendarOnly&&(!mapping||mapping.calendar_id!==options.expectedCalendar||mapping.event_id!==options.expectedEvent))return message('行程已變更，未刪除。');
  if(!mapping)return message('找不到這筆備忘對應的機器人日曆行程，未刪除。若曾手動加入日曆，請到 Google 日曆自行移除；或選「只刪備忘」。');
  const connection=await q(db,'SELECT * FROM google_connections WHERE owner_id=?',owner).first();
  if(!connection||connection.calendar_id!==mapping.calendar_id)return message('日曆連結不符，備忘未刪除。請重新連結原本的 Google 帳號。');
  try{
   if(mapping.state!=='deleted'){
    const access=options.access||await calendarAccess(env,connection,fetcher);
    const calendarPath='calendars/'+encodeURIComponent(mapping.calendar_id),eventPath=calendarPath+'/events/'+encodeURIComponent(mapping.event_id);
    const current=await calendarApi(eventPath,access,{},fetcher);
    let absent=false,etag;
    if(current.status===410)absent=true;
    else if(current.status===404){
     const calendar=await calendarApi(calendarPath,access,{},fetcher);
     if(!calendar.ok)throw Error('Calendar not accessible');
     absent=true;
    }else if(current.ok){
     const event=await current.json();
     if(event.status==='cancelled')absent=true;
     else {
      if(event.extendedProperties?.private?.memoId!==String(itemId)||event.extendedProperties?.private?.memoOwner!==await digest(owner))throw Error('Calendar event ownership mismatch');
      if(event.attendees?.length)return message('這個行程已有受邀者，未自動刪除，備忘保留。請到 Google 日曆確認後處理。');
      etag=event.etag;
      if(options.calendarOnly&&(!etag||etag!==options.expectedEtag))return message('行程已變更，未刪除。請重新查看並確認。');
      if(options.endedBefore&&!eventHasEnded(event,options.endedBefore))return message('行程尚未結束，未刪除。');
     }
    }else throw Error('Calendar event verification failed');
    if(!absent){
     // The exact stored event ID and its ownership marker were verified above.
     const removed=await googleFetch('https://www.googleapis.com/calendar/v3/'+eventPath+'?sendUpdates=none',{method:'DELETE',headers:{Authorization:'Bearer '+access,...(etag?{'If-Match':etag}:{})}},fetcher);
     if(!removed.ok&&removed.status!==410)throw Error('Calendar deletion not confirmed');
    }
    await q(db,"UPDATE memo_calendar_events SET state='deleted' WHERE item_id=? AND calendar_id=? AND event_id=?",itemId,mapping.calendar_id,mapping.event_id).run();
   }
   if(options.calendarOnly)return message('✅ #'+itemId+' 日曆行程已刪除，備忘保留。');
   await q(db,'UPDATE memo_items SET deleted_at=?,updated_at=? WHERE owner_id=? AND id=? AND deleted_at IS NULL',new Date().toISOString(),new Date().toISOString(),owner,itemId).run();
   return message('✅ #'+itemId+' 備忘與日曆行程已刪除。');
  }catch(error){console.error('Google calendar deletion failed:',error.name);return message('尚未確認日曆刪除成功，備忘已保留。請稍後重試；不會刪除其他行程。');}
 },Boolean(options.calendarOnly));
}

export async function setNoticeMinutes(env,owner,itemId,minutes,fetcher=fetch){
 return withCalendarLock(env,owner,itemId,async()=>{
  const db=env.MEMO_DB,item=await q(db,'SELECT * FROM memo_items WHERE owner_id=? AND id=? AND deleted_at IS NULL',owner,itemId).first();
  const invalid=noticeError(item,minutes);if(invalid)return message(invalid);
  const mapping=await q(db,'SELECT * FROM memo_calendar_events WHERE item_id=?',itemId).first();
  if(mapping?.state==='pending')return message('上一筆日曆新增結果尚未確認，請先重新點「確認新增至日曆」，再調整通知時間。');
  if(mapping?.state==='deleted')return message('這筆日曆行程已刪除，請重新建立提醒。');
  if(mapping?.state==='added'){
   if(!configured(env))return message('Google 串接未完成，尚未變更通知時間。');
   const connection=await q(db,'SELECT * FROM google_connections WHERE owner_id=?',owner).first();
   if(!connection||connection.calendar_id!==mapping.calendar_id)return message('日曆連結不符，尚未變更通知時間。');
   try{
    const stored=await unseal(connection.credentials,env),r=await tokenRequest(env,{grant_type:'refresh_token',refresh_token:stored.refreshToken},fetcher);
    if(!r.ok)return message('Google 授權失效，請輸入「連結日曆」重新授權，通知時間尚未變更。');
    const access=(await r.json()).access_token;if(!access)throw Error('Missing access token');
    const path='calendars/'+encodeURIComponent(mapping.calendar_id)+'/events/'+encodeURIComponent(mapping.event_id);
    const current=await calendarApi(path,access,{},fetcher);if(!current.ok)throw Error('Event lookup failed');
    const event=await current.json();
    if(event.status==='cancelled'||event.extendedProperties?.private?.memoId!==String(itemId)||event.extendedProperties?.private?.memoOwner!==await digest(owner))throw Error('Event ownership mismatch');
    const changed=await googleFetch('https://www.googleapis.com/calendar/v3/'+path+'?sendUpdates=none',{method:'PATCH',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json',...(event.etag?{'If-Match':event.etag}:{})},body:JSON.stringify({reminders:{useDefault:false,overrides:[{method:'popup',minutes}]}})},fetcher);
    if(!changed.ok)throw Error('Reminder update not confirmed');
   }catch(error){console.error('Google reminder update failed:',error.name);return message('尚未確認日曆通知更新成功，請稍後重試；不會更改行程日期或時間。');}
  }
  await q(db,'UPDATE memo_items SET notice_minutes=?,updated_at=? WHERE owner_id=? AND id=? AND deleted_at IS NULL',minutes,new Date().toISOString(),owner,itemId).run();
  return message('✅ #'+itemId+' 已設為'+noticeLabel(minutes)+'。'+(mapping?.state==='added'?'\nGoogle 日曆通知已同步更新。':'\n加入 Google 日曆後才會通知。'));
 });
}


// Calendar management is limited to stored mappings and verified app-owned events.
async function calendarAccess(env,connection,fetcher){
 const stored=await unseal(connection.credentials,env);
 const response=await tokenRequest(env,{grant_type:'refresh_token',refresh_token:stored.refreshToken},fetcher);
 if(!response.ok)throw Error('Calendar authorization unavailable');
 const token=await response.json();if(!token.access_token)throw Error('Access token missing');return token.access_token;
}
export function eventHasEnded(event,before=Date.now()){
 // All-day events use an exclusive end date; interpret it in the memo calendar's Taipei zone.
 const end=event.end?.dateTime|| (event.end?.date?event.end.date+'T00:00:00+08:00':null);
 return Boolean(end)&&Number.isFinite(Date.parse(end))&&Date.parse(end)<=before&&!event.recurrence?.length&&!event.recurringEventId;
}
const calendarButton=(label,value)=>({type:'action',action:{type:'message',label,text:value}});
const managementFooter=()=>[calendarButton('已結束行程','已結束行程'),calendarButton('清除已結束','清除已結束行程'),calendarButton('清除全部行程','清除日曆'),calendarButton('取消','取消日曆清除')];
const calendarStamp=value=>value?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'未設定時間';
async function managedRows(env,owner,fetcher,offset=0,limit=5){
 if(!configured(env))throw Error('Calendar not configured');
 const connection=await q(env.MEMO_DB,'SELECT * FROM google_connections WHERE owner_id=?',owner).first();
 if(!connection)throw Error('Calendar not linked');
 const rows=(await q(env.MEMO_DB,"SELECT i.id,i.content,i.due_at,m.calendar_id,m.event_id FROM memo_items i JOIN memo_calendar_events m ON m.item_id=i.id WHERE i.owner_id=? AND m.state IN ('added','pending') AND m.calendar_id=? ORDER BY i.due_at,i.id LIMIT ? OFFSET ?",owner,connection.calendar_id,limit,offset).all()).results;
 if(!rows.length)return {rows:[],access:null};
 const access=await calendarAccess(env,connection,fetcher),ownerKey=await digest(owner);
 const inspected=await Promise.all(rows.map(async row=>{
  try{
   const response=await calendarApi('calendars/'+encodeURIComponent(row.calendar_id)+'/events/'+encodeURIComponent(row.event_id),access,{},fetcher);
   if(!response.ok)return {...row,unavailable:true};
   const event=await response.json();
   if(event.status==='cancelled')return {...row,unavailable:true};
   if(event.extendedProperties?.private?.memoId!==String(row.id)||event.extendedProperties?.private?.memoOwner!==ownerKey||event.attendees?.length||event.recurrence?.length||event.recurringEventId||!event.etag)return {...row,unavailable:true};
   return {...row,event};
  }catch{return {...row,unavailable:true};}
 }));
 return {rows:inspected,access};
}
export async function calendarItems(env,owner,ended=false,page=1,fetcher=fetch){
 if(!Number.isInteger(page)||page<1||page>1000)return message('頁碼無效。');
 try{
 const {rows}=await managedRows(env,owner,fetcher,(page-1)*5,5);
 const visible=rows.filter(r=>!ended||(r.event&&eventHasEnded(r.event)));
 const title=ended?'📆 已結束行程':'📆 日曆行程';
 const reply=message(title+'（僅機器人建立）\n'+(visible.length?visible.map(r=>'#'+r.id+' '+String(r.event?.summary||r.content).slice(0,70)+'\n'+(r.event?calendarStamp(r.event.start?.dateTime||(r.event.start?.date+'T00:00:00+08:00'))+(eventHasEnded(r.event)?'｜已結束':''):'無法確認，請到 Google 日曆查看')).join('\n\n'):'這一頁沒有符合的行程。')+'\n\n刪除日曆時，備忘會保留。');
 reply.quickReply={items:[...visible.filter(r=>r.event).map(r=>calendarButton('刪除 #'+r.id,'刪除日曆 '+r.id)),...managementFooter()]};
 if(rows.length===5)reply.quickReply.items.push(calendarButton('下一頁',(ended?'已結束行程 ':'日曆行程 ')+(page+1)));
 return reply;
 }catch{return message('無法讀取日曆，請稍後重試；若授權失效請輸入「連結日曆」。');}
}
export async function previewCalendarClear(env,owner,scope,fetcher=fetch){
 try{
 // Bound each operation to three events to keep confirmations readable and reply requests short.
 let rows;
 if(Number.isInteger(scope)){
  const connection=await q(env.MEMO_DB,'SELECT * FROM google_connections WHERE owner_id=?',owner).first();
  if(!connection)return message('請先輸入「連結日曆」。');
  const row=await q(env.MEMO_DB,"SELECT i.id,i.content,i.due_at,m.calendar_id,m.event_id FROM memo_items i JOIN memo_calendar_events m ON m.item_id=i.id WHERE i.owner_id=? AND i.id=? AND m.calendar_id=? AND m.state IN ('added','pending')",owner,scope,connection.calendar_id).first();
  if(!row)return message('找不到這筆機器人日曆行程。');
  const access=await calendarAccess(env,connection,fetcher);
  const response=await calendarApi('calendars/'+encodeURIComponent(row.calendar_id)+'/events/'+encodeURIComponent(row.event_id),access,{},fetcher);
  if(!response.ok)return message('無法確認這筆日曆行程，未刪除。');
  const event=await response.json();
  if(event.status==='cancelled'||event.extendedProperties?.private?.memoId!==String(row.id)||event.extendedProperties?.private?.memoOwner!==await digest(owner)||event.attendees?.length||event.recurrence?.length||event.recurringEventId||!event.etag)return message('這筆行程不適合由機器人刪除，請到 Google 日曆查看。');
  rows=[{...row,event}];
 }else{
  if(!['ended','all'].includes(scope))return message('清除範圍無效。');
  rows=(await managedRows(env,owner,fetcher,0,10)).rows;
 }
 const selected=rows.filter(r=>r.event&&(scope!=='ended'||eventHasEnded(r.event))).slice(0,3);
 if(!selected.length)return message('目前這批沒有可清除的'+(scope==='ended'?'已結束':'機器人')+'行程；可從「日曆行程」逐頁查看。');
 const token=crypto.randomUUID().replace(/-/g,''),expires=Date.now()+120000;
 await q(env.MEMO_DB,'DELETE FROM memo_calendar_confirmations WHERE expires_at<=? OR owner_id=?',Date.now(),owner).run();
 const payload={scope,items:selected.map(r=>({id:r.id,calendar_id:r.calendar_id,event_id:r.event_id,etag:r.event.etag}))};
 await q(env.MEMO_DB,'INSERT INTO memo_calendar_confirmations VALUES(?,?,?,?)',token,owner,JSON.stringify(payload),expires).run();
 return {...message('是否刪除以下 '+selected.length+' 筆日曆行程？'+(scope==='all'?'\n⚠️ 包含尚未開始的行程。':'')+'\n\n'+selected.map(r=>'#'+r.id+' '+String(r.event.summary||r.content).slice(0,90)+'｜'+calendarStamp(r.event.start?.dateTime||(r.event.start?.date+'T00:00:00+08:00'))).join('\n')+'\n\n備忘保留。日曆刪除無法由機器人復原。\n本次只刪上述行程，2分鐘內有效。'),quickReply:{items:[
 {type:'action',action:{type:'postback',label:'確認刪除日曆',data:'memo:calclear:'+token,displayText:'確認刪除上述日曆行程'}},
 calendarButton('取消','取消日曆清除')
 ]}};
 }catch{return message('日曆清除預覽失敗，沒有刪除行程。請稍後重試或重新連結日曆。');}
}
export async function cancelCalendarClear(env,owner){
 await q(env.MEMO_DB,'DELETE FROM memo_calendar_confirmations WHERE owner_id=?',owner).run();
 return message('已取消，日曆行程保留。');
}
export async function confirmCalendarClear(env,owner,token,fetcher=fetch){
 const claimed=(await q(env.MEMO_DB,'DELETE FROM memo_calendar_confirmations WHERE token=? AND owner_id=? AND expires_at>? RETURNING payload',token,owner,Date.now()).all()).results[0];
 if(!claimed)return message('確認已使用、取消或逾時，請重新選擇行程。');
 const payload=JSON.parse(claimed.payload);
 try{
 const connection=await q(env.MEMO_DB,'SELECT * FROM google_connections WHERE owner_id=?',owner).first();
 if(!connection||payload.items.some(r=>r.calendar_id!==connection.calendar_id))throw Error('Calendar changed');
 const access=await calendarAccess(env,connection,fetcher);
 const results=await Promise.all(payload.items.map(async item=>{
  // Refuse new mappings or replaced events even if the memo number stays the same.
  const mapping=await q(env.MEMO_DB,'SELECT * FROM memo_calendar_events WHERE item_id=?',item.id).first();
  if(!mapping||mapping.calendar_id!==item.calendar_id||mapping.event_id!==item.event_id)return '#'+item.id+' 行程已變更，未刪除。';
  const reply=await deleteCalendarAndMemo(env,owner,item.id,fetcher,{calendarOnly:true,expectedCalendar:item.calendar_id,expectedEvent:item.event_id,expectedEtag:item.etag,endedBefore:payload.scope==='ended'?Date.now():null,access});
  return reply.text;
 }));
 return {...message(results.join('\n')+'\n備忘與待辦紀錄保留。'),quickReply:{items:[calendarButton('查看日曆行程','日曆行程'),calendarButton('繼續清除已結束','清除已結束行程')]}};
 }catch{return message('日曆清除未完成，請重新查看再試。備忘保留。');}
}
