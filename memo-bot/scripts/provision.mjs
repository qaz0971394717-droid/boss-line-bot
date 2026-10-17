import {GOOGLE_SCHEMA} from '../src/google.js';
import {readFileSync,writeFileSync} from 'node:fs';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!account||!token)throw Error('Cloudflare authorization missing');
for(const key of ['MEMO_LINE_CHANNEL_ACCESS_TOKEN','MEMO_LINE_CHANNEL_SECRET'])if(!process.env[key])throw Error('New memo bot secret missing: '+key);
if(!/^U[a-f0-9]{32}$/i.test(process.env.MEMO_OWNER_LINE_USER_ID||''))console.log('::warning::MEMO_OWNER_LINE_USER_ID missing or invalid. The new bot will remain locked.');
// Refuse to change any already-connected channel other than this memo bot.
const endpoint='https://hongzhe-personal-memo.qaz0971394717.workers.dev/callback';
const existing=await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint',{headers:{Authorization:'Bearer '+process.env.MEMO_LINE_CHANNEL_ACCESS_TOKEN},redirect:'error',signal:AbortSignal.timeout(15000)});
if(existing.ok){const current=await existing.json();if(current.endpoint&&current.endpoint!==endpoint)throw Error('This LINE channel already has a different webhook. Refusing to alter it.');}else if(existing.status!==404)throw Error('New memo LINE token verification failed');
const root=`https://api.cloudflare.com/client/v4/accounts/${account}`;
async function api(path,body,method=body?'POST':'GET'){
 const r=await fetch(root+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(30000)});
 const data=await r.json();if(!r.ok||!data.success)throw Error('Memo provisioning API failed: '+r.status);return data.result;
}
const list=await api('/d1/database?per_page=100');const matches=list.filter(d=>d.name==='hongzhe-personal-memo');if(matches.length>1)throw Error('Ambiguous memo database');
const db=matches[0]||await api('/d1/database',{name:'hongzhe-personal-memo'});
if(['db692969-0b74-4dc5-952a-604847e15628','dfe1d761-05b1-4a72-b7b6-cd8255b9e7f5'].includes(db.uuid))throw Error('Memo database must be isolated');
const result=await api(`/d1/database/${db.uuid}/query`,{sql:readFileSync('schema.sql','utf8')+';'+GOOGLE_SCHEMA});if(result.some(r=>!r.success))throw Error('Memo schema failed');
writeFileSync('wrangler.toml',`name = "hongzhe-personal-memo"\nmain = "src/index.js"\ncompatibility_date = "2026-10-01"\n[[d1_databases]]\nbinding = "MEMO_DB"\ndatabase_name = "hongzhe-personal-memo"\ndatabase_id = "${db.uuid}"\n`);
console.log('Memo isolated D1 ready. Existing bot databases were not changed.');
