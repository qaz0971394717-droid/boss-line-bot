import {execFileSync} from 'node:child_process';
const key=process.env.DISCORD_PUBLIC_KEY,chat=process.env.DISCORD_KB_LINE_CHAT_ID;
if(key||chat){
 if(!/^[a-f0-9]{64}$/i.test(key||'')||!/^C[a-f0-9]{32}$/i.test(chat||''))throw Error('Both valid Discord public key and fixed LINE group mapping are required');
 execFileSync('./node_modules/.bin/wrangler',['secret','bulk','--config','wrangler.production.toml'],{input:JSON.stringify({DISCORD_PUBLIC_KEY:key,DISCORD_KB_LINE_CHAT_ID:chat}),stdio:['pipe','pipe','pipe']});
}
const r=await fetch('https://hit2-boss-production.qaz0971394717.workers.dev/',{signal:AbortSignal.timeout(15000)});
if(!r.ok)throw Error('Discord readiness check failed');
const health=await r.json();console.log(JSON.stringify({discord_kb_configured:health.discord_kb_enabled===true}));
if(!health.discord_kb_enabled)console.log('::warning::Discord KB requires its original application public key and fixed LINE group mapping; endpoint remains closed until configured.');
