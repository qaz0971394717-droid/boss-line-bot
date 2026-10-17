import {googleRoute} from './google.js';
import {fetchLineReply} from './http.js';
import {knownCommand,runCommand} from './commands.js';
const encode=s=>new TextEncoder().encode(s);
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function verifySignature(body,signature,secret){
 if(!secret||!signature)return false;
 try{const key=await crypto.subtle.importKey('raw',encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);return crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(signature),c=>c.charCodeAt(0)),encode(body));}catch{return false;}
}
const q=(db,sql,...p)=>db.prepare(sql).bind(...p);
export function createWorker({fetcher=fetch}={}){return {
 async fetch(request,env,ctx){
  const path=new URL(request.url).pathname;
  const googleResponse=await googleRoute(request,env,fetcher);if(googleResponse)return googleResponse;
  if(request.method==='GET'&&path==='/')return json({service:'hongzhe-personal-memo',status:'ok',database_backend:'d1',owner_configured:/^U[a-f0-9]{32}$/i.test(env.OWNER_LINE_USER_ID||''),push_enabled:false});
  if(request.method!=='POST'||path!=='/callback')return new Response('Not Found',{status:404});
  const body=await request.text();if(!await verifySignature(body,request.headers.get('x-line-signature'),env.LINE_CHANNEL_SECRET))return new Response('Invalid signature',{status:401});
  let payload;try{payload=JSON.parse(body);}catch{return json({error:'Invalid JSON'},400);}if(!Array.isArray(payload?.events))return json({error:'Invalid events'},400);
  // Empty verification payloads can pass before owner enrollment; no data is read.
  if(!payload.events.length)return json({ok:true});
  if(!/^U[a-f0-9]{32}$/i.test(env.OWNER_LINE_USER_ID||'')||!env.MEMO_DB||!env.LINE_CHANNEL_ACCESS_TOKEN)return json({error:'Personal memo locked until owner configuration completes'},503);
  const processing=(async()=>{
   let failed=0;
   for(const event of payload.events){
    if(!event||event.mode==='standby'||event.source?.type!=='user'||event.source.userId!==env.OWNER_LINE_USER_ID||!event.replyToken)continue;
    if(!Number.isFinite(event.timestamp)||event.timestamp<Date.now()-14*86400000||event.timestamp>Date.now()+300000)continue;
    const command=event.type==='message'&&event.message?.type==='text'?event.message.text:event.type==='postback'&&/^memo:delete:\d+$/.test(event.postback?.data||'')?'確認刪除 '+event.postback.data.split(':')[2]:event.type==='postback'&&/^memo:deleteboth:\d+$/.test(event.postback?.data||'')?'連同日曆刪除 '+event.postback.data.split(':')[2]:event.type==='postback'&&/^memo:calendar:\d+$/.test(event.postback?.data||'')?'加入日曆 '+event.postback.data.split(':')[2]:null;
    if(typeof command!=='string'||!knownCommand(command))continue;
    if(typeof event.webhookEventId!=='string'||!event.webhookEventId){failed++;continue;}
    const db=env.MEMO_DB,id=event.webhookEventId,stamp=new Date().toISOString();
    try{
     const claimed=await q(db,"INSERT INTO memo_events(event_id,state,created_at,updated_at) VALUES(?,'pending',?,?) ON CONFLICT(event_id) DO NOTHING RETURNING event_id",id,stamp,stamp).all();
     let reply;
     if(!claimed.results.length){const old=await q(db,'SELECT state,reply FROM memo_events WHERE event_id=?',id).first();if(old?.state==='delivered')continue;if(old?.state!=='ready'||!old.reply)throw Error('Pending event requires reconciliation');reply=JSON.parse(old.reply);}
     else {
      reply=await runCommand(command,{db,owner:env.OWNER_LINE_USER_ID,eventId:id,now:new Date(event.timestamp),env,fetcher});
      await q(db,"UPDATE memo_events SET state='ready',reply=?,updated_at=? WHERE event_id=?",JSON.stringify(reply),new Date().toISOString(),id).run();
     }
     const response=await fetchLineReply('https://api.line.me/v2/bot/message/reply',{method:'POST',headers:{Authorization:`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({replyToken:event.replyToken,messages:[reply]}),},fetcher);
     if(!response.ok){console.error('Memo LINE HTTP status:',response.status);throw Error('LINE reply unavailable');}
     await q(db,"UPDATE memo_events SET state='delivered',updated_at=? WHERE event_id=?",new Date().toISOString(),id).run();
    }catch(error){console.error('Personal memo event failed:',error.name);failed++;}
   }
   return json({ok:!failed},failed?500:200);
  })();ctx?.waitUntil(processing);return processing;
 }
};}
export default createWorker();
