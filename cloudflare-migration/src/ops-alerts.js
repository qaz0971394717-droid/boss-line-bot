// Only the separate test bot can bind a destination or send operational pushes.
const enc=new TextEncoder();
export async function bindingCode(key){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(key)))].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,12);}
export async function bindAlerts(command,chatId,env){
 if(command.trim()!=='啟用異常通知')return null;
 if(env.ENABLE_OPS_ALERTS!=='true'||!env.OPS_ALERT_KEY)return {type:'text',text:'通知綁定尚未開放。'};
 const known=await env.BOSS_DB.prepare('SELECT chat_id FROM chat_settings WHERE chat_id=?').bind(chatId).first();
 if(!known)return {type:'text',text:'請在既有的報王測試群組啟用通知。'};
 const old=await env.BOSS_DB.prepare('SELECT chat_id FROM ops_destination WHERE id=1').first();
 if(old&&old.chat_id!==chatId)return {type:'text',text:'已有通知目的地，請先由維護者解除。'};
 await env.BOSS_DB.prepare('INSERT OR IGNORE INTO ops_destination(id,chat_id) VALUES(1,?)').bind(chatId).run();
 return {type:'text',text:'✅ 異常通知已綁定此對話。異常及恢復各通知一次。'};
}
export async function opsRoute(request,env,fetcher=fetch){
 if(new URL(request.url).pathname!=='/ops/notify')return null;
 if(env.ENABLE_OPS_ALERTS!=='true'||!env.OPS_ALERT_KEY)return new Response('Disabled',{status:404});
 const provided=request.headers.get('authorization')||'';
 const digest=async v=>new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(v)));
 const a=await digest(provided),b=await digest(`Bearer ${env.OPS_ALERT_KEY}`);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
 if(diff||request.method!=='POST')return new Response('Unauthorized',{status:401});
 let p;try{p=await request.json();}catch{return new Response('Invalid',{status:400});}
 if(!/^(production|staging|memo|parts)$/.test(p.target)||!['alert','recovery'].includes(p.kind))return new Response('Invalid',{status:400});
 const destination=await env.BOSS_DB.prepare('SELECT chat_id FROM ops_destination WHERE id=1').first();
 if(!destination)return new Response('Destination not bound',{status:409});
 const retryKey=typeof p.retryKey==='string'&&/^[0-9a-f-]{36}$/.test(p.retryKey)?p.retryKey:null;
 if(!retryKey)return new Response('Invalid retry key',{status:400});
 const label={production:'正式版',staging:'測試版',memo:'備忘錄',parts:'零件查詢'}[p.target];
 const text=p.kind==='recovery'?`✅ ${label}資料庫警示已解除。`:`⚠️ ${label}：${String(p.message||'維護檢查失敗').slice(0,220)}\n請查看 GitHub Actions。`;
 const previous=await env.BOSS_DB.prepare('SELECT status,created_at FROM ops_deliveries WHERE id=?').bind(retryKey).first();
 if(previous?.status!=='sent'&&previous&&Date.now()-previous.created_at>23*3600000)return new Response('Manual reconciliation required',{status:503});
 const now=Date.now();
 const claim=await env.BOSS_DB.prepare("INSERT INTO ops_deliveries(id,status,updated_at,created_at,message) VALUES(?,'pending',?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at WHERE ops_deliveries.status!='sent' AND ops_deliveries.updated_at<? RETURNING id").bind(retryKey,now,now,text,now-60000).all();
 if(!claim.results.length){const old=await env.BOSS_DB.prepare('SELECT status FROM ops_deliveries WHERE id=?').bind(retryKey).first();return new Response(old?.status==='sent'?'Sent':'Pending',{status:old?.status==='sent'?200:503});}
 const stored=await env.BOSS_DB.prepare('SELECT message FROM ops_deliveries WHERE id=?').bind(retryKey).first();
 const r=await fetcher('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,'Content-Type':'application/json','X-Line-Retry-Key':retryKey},body:JSON.stringify({to:destination.chat_id,messages:[{type:'text',text:stored.message}]}),signal:AbortSignal.timeout(15000)});
 if(r.ok||r.status===409)await env.BOSS_DB.prepare("UPDATE ops_deliveries SET status='sent' WHERE id=?").bind(retryKey).run();
 return new Response(r.ok||r.status===409?'Sent':'LINE push failed',{status:r.ok||r.status===409?200:502});
}
