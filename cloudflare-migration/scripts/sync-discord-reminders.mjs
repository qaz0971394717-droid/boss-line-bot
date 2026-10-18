// A short-lived authenticated Worker reuses the original mapped Discord DO.
// It reads existing future BOSS records, never edits BOSS data, and is removed.
import {readFileSync} from 'node:fs';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,credential=process.env.CLOUDFLARE_API_TOKEN;
if(!account||!credential)throw Error('Cloudflare authorization missing');
const name='hit2-discord-sync-'+process.env.GITHUB_RUN_ID,auth=crypto.randomUUID()+crypto.randomUUID();
const root='https://api.cloudflare.com/client/v4/accounts/'+account;
async function api(path,method='GET',body){
 const response=await fetch(root+path,{method,headers:{Authorization:'Bearer '+credential,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(30000)});
 const data=await response.json();if(!response.ok||!data.success)throw Error('Discord sync provisioning failed: HTTP '+response.status);return data.result;
}
const health=await fetch('https://hit2-boss-production.qaz0971394717.workers.dev',{redirect:'error',signal:AbortSignal.timeout(10000)}).then(r=>r.json());
if(!health.discord_reminders_enabled||health.line_reminders_enabled!==false)throw Error('Production reminder safety configuration mismatch');
let created=false;
try{
 const metadata={main_module:'index.js',compatibility_date:'2026-10-01',bindings:[
  {type:'secret_text',name:'SYNC_AUTH',text:auth},
  {type:'plain_text',name:'PRODUCTION_MODE',text:'true'},
  {type:'plain_text',name:'ENABLE_DISCORD_REMINDERS',text:'true'},
  {type:'d1',name:'BOSS_DB',id:'db692969-0b74-4dc5-952a-604847e15628'},
  {type:'durable_object_namespace',name:'DISCORD_REMINDER',class_name:'BossReminder',script_name:'hit2-boss-reminder-v2'}
 ]};
 const form=new FormData();form.append('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));
 form.append('index.js',new Blob([readFileSync(new URL('./sync-discord-reminders-worker.mjs',import.meta.url),'utf8')],{type:'application/javascript+module'}),'index.js');
 form.append('discord-reminders.js',new Blob([readFileSync(new URL('../src/discord-reminders.js',import.meta.url),'utf8')],{type:'application/javascript+module'}),'discord-reminders.js');
 await api('/workers/scripts/'+name,'PUT',form);created=true;
 await api('/workers/scripts/'+name+'/subdomain','POST',{enabled:true});
 const {subdomain}=await api('/workers/subdomain');
 let result;
 for(let attempt=0;attempt<5;attempt++){
  const response=await fetch('https://'+name+'.'+subdomain+'.workers.dev',{method:'POST',headers:{Authorization:'Bearer '+auth},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(response.status===404){await new Promise(r=>setTimeout(r,2000));continue;}
  if(!response.ok)throw Error('Existing Discord schedule sync not fully confirmed: HTTP '+response.status);
  result=await response.json();break;
 }
 if(!result||result.failed)throw Error('Existing Discord schedule sync incomplete');
 console.log('Existing Discord schedules synchronized: '+JSON.stringify(result));
}finally{
 if(created){await api('/workers/scripts/'+name,'DELETE');console.log('Removed temporary authenticated sync Worker.');}
}
